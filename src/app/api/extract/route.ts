import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  DiagnosisSuggestion,
  EMPTY_CLAIM,
  FxConversion,
  MappingSuggestion,
  ProviderClassification,
  ValidationWarning,
} from "@/lib/types";

const EXTRACTION_PROMPT = `You are a medical receipt/invoice data extraction assistant. Analyze the provided document and extract the following information. If the document is in a language other than English, translate all values into English.

Return a JSON object with exactly these fields:
- providerName: The name of the healthcare provider, clinic, or hospital
- providerAddress: The full address of the provider
- serviceCountry: Country where service was provided
- dateOfService: The date the service was provided (format: YYYY-MM-DD)
- description: A brief description of the medical service(s) provided
- diagnosis: The diagnosis or reason for visit, if mentioned
- amountCharged: The total amount charged (numbers only, no currency symbol)
- currency: The 3-letter currency code (e.g., USD, EUR, ILS, JPY)
- receiptNumber: The invoice or receipt number
- memberId: Member/subscriber ID if present
- insuranceGroup: Insurance group number/name if present
- gender: "male", "female", or empty string
- foreignProvider: "yes" if provider is outside the US, otherwise "no" or empty string
- claimType: one of "lab", "doctor_visit", "hospital", "imaging", "pharmacy", "other", or empty string
- diagnosisCode: ICD-10-CM code if explicitly present, otherwise empty string

If a field is not found in the document, return an empty string for that field.
Return ONLY the JSON object, no markdown formatting or explanation.`;

const MAPPING_PROMPT = `You are mapping claim data to PDF field names.
Given:
1) claimData extracted from invoice/user profile
2) PDF field definitions from a health insurance form

Return STRICT JSON with this shape:
{
  "mappingSuggestions": [
    {
      "pdfFieldName": "string",
      "claimDataKey": "string",
      "transform": "none|date_month|date_day|date_year|checkbox_truthy|checkbox_equals",
      "staticValue": "string optional",
      "confidence": 0.0,
      "reason": "short explanation"
    }
  ],
  "validationWarnings": [
    {
      "code": "string",
      "message": "string",
      "severity": "info|warning|error"
    }
  ]
}

Rules:
- For DOB split fields, use date_month/date_day/date_year.
- For checkbox male/female fields, use claimDataKey="gender", transform="checkbox_equals", staticValue "male" or "female".
- For claim-type checkboxes (lab/doctor/hospital/imaging/pharmacy), use claimDataKey="claimType", transform="checkbox_equals", staticValue to the exact category string.
- For foreign-country checkboxes, use claimDataKey="foreignProvider", transform="checkbox_truthy".
- Include only suggestions with confidence >= 0.55.
- Return JSON only.`;

function formatGeminiError(
  errorObj: { message?: string; status?: number; code?: number | string }
): { message: string; status: number } {
  const rawMessage = errorObj.message || "Extraction failed";
  const status = errorObj.status ?? 500;

  if (
    status === 429 ||
    rawMessage.includes("Too Many Requests") ||
    rawMessage.includes("Quota exceeded")
  ) {
    const retryMatch =
      rawMessage.match(/retry in\s+(\d+(?:\.\d+)?)s/i) ||
      rawMessage.match(/"retryDelay":"(\d+)s"/i);
    const retryHint = retryMatch
      ? ` Please try again in about ${Math.ceil(Number(retryMatch[1]))} seconds.`
      : "";

    return {
      status: 429,
      message:
        "Gemini API quota exceeded for this project/account. Enable billing or increase quota in Google AI Studio/Google Cloud, or wait for quota reset." +
        retryHint,
    };
  }

  if (
    status === 403 ||
    rawMessage.includes("permission") ||
    rawMessage.includes("not allowed")
  ) {
    return {
      status: 403,
      message:
        "Gemini API key does not have access to this model/project. Verify the key, project, and API access in Google AI Studio.",
    };
  }

  if (
    status === 400 &&
    (rawMessage.includes("API key expired") ||
      rawMessage.includes("API_KEY_INVALID") ||
      rawMessage.includes("API key not valid"))
  ) {
    return {
      status: 401,
      message:
        "Gemini API key is invalid or expired. Create a new API key in Google AI Studio, update GEMINI_API_KEY in .env.local, and restart the dev server.",
    };
  }

  if (
    status === 404 &&
    (rawMessage.includes("no longer available to new users") ||
      rawMessage.includes("is not found for API version") ||
      rawMessage.includes("not supported for generateContent"))
  ) {
    return {
      status: 400,
      message:
        "Configured Gemini model is unavailable for this account/version. Set GEMINI_MODEL in .env.local to a current model (for example: gemini-2.5-flash), then restart the dev server.",
    };
  }

  return { status, message: rawMessage };
}

function sanitizeClaimType(value: unknown): string {
  const raw = String(value || "").trim().toLowerCase();
  if (
    raw === "lab" ||
    raw === "doctor_visit" ||
    raw === "hospital" ||
    raw === "imaging" ||
    raw === "pharmacy" ||
    raw === "other"
  ) {
    return raw;
  }
  return "";
}

function heuristicProviderClassification(
  providerName: string,
  description: string
): ProviderClassification {
  const text = `${providerName} ${description}`.toLowerCase();
  const rules: Array<{
    category: ProviderClassification["category"];
    terms: string[];
    confidence: number;
    evidence: string;
  }> = [
    { category: "lab", terms: ["lab", "laboratory", "pathology", "blood test"], confidence: 0.86, evidence: "Lab keywords found" },
    { category: "hospital", terms: ["hospital", "emergency", "er", "urgent care", "outpatient", "inpatient"], confidence: 0.85, evidence: "Hospital keywords found" },
    { category: "imaging", terms: ["x-ray", "xray", "mri", "ct", "ultrasound", "radiology"], confidence: 0.88, evidence: "Imaging keywords found" },
    { category: "pharmacy", terms: ["pharmacy", "drug", "prescription", "rx"], confidence: 0.9, evidence: "Pharmacy keywords found" },
    { category: "doctor_visit", terms: ["clinic", "doctor", "physician", "consultation", "office visit"], confidence: 0.78, evidence: "Doctor visit keywords found" },
  ];
  for (const rule of rules) {
    if (rule.terms.some((term) => text.includes(term))) {
      return {
        category: rule.category,
        confidence: rule.confidence,
        source: "heuristic",
        evidence: rule.evidence,
        lookupUsed: false,
      };
    }
  }
  return {
    category: "other",
    confidence: 0.5,
    source: "heuristic",
    evidence: "No strong provider keywords found",
    lookupUsed: false,
  };
}

function mapLookupTypeToCategory(lookupType: string): ProviderClassification["category"] {
  const type = lookupType.toLowerCase();
  if (type.includes("hospital")) return "hospital";
  if (type.includes("clinic") || type.includes("doctor")) return "doctor_visit";
  if (type.includes("pharmacy")) return "pharmacy";
  if (type.includes("laboratory") || type.includes("lab")) return "lab";
  if (type.includes("radiology") || type.includes("imaging")) return "imaging";
  return "other";
}

async function classifyProviderWithLookup(
  providerName: string,
  providerAddress: string
): Promise<ProviderClassification | null> {
  const q = encodeURIComponent(`${providerName} ${providerAddress}`.trim());
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "HealthPDF/1.0",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Array<{ type?: string; class?: string; display_name?: string }>;
  const hit = json?.[0];
  if (!hit) return null;
  const lookupSignal = `${hit.class || ""} ${hit.type || ""}`.trim();
  return {
    category: mapLookupTypeToCategory(lookupSignal),
    confidence: 0.8,
    source: "lookup",
    evidence: hit.display_name || lookupSignal || "Provider lookup match found",
    lookupUsed: true,
  };
}

function inferCurrencyFromText(text: string): string {
  const raw = text.toLowerCase();
  if (raw.includes(" usd") || raw.includes("$")) return "USD";
  if (raw.includes(" eur") || raw.includes("euro")) return "EUR";
  if (raw.includes(" gbp") || raw.includes("pound")) return "GBP";
  if (raw.includes(" ils") || raw.includes("nis") || raw.includes("shekel")) return "ILS";
  if (raw.includes(" jpy") || raw.includes("yen")) return "JPY";
  if (raw.includes(" cad")) return "CAD";
  if (raw.includes(" aud")) return "AUD";
  return "";
}

function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function convertToUsd(
  sourceCurrency: string,
  amount: number,
  date: string
): Promise<FxConversion> {
  const rateDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().split("T")[0];
  if (!sourceCurrency || sourceCurrency === "USD") {
    return {
      sourceCurrency: sourceCurrency || "USD",
      sourceAmount: amount,
      usdAmount: amount,
      rate: 1,
      rateDate,
      provider: "identity",
      status: "ok",
    };
  }
  const url = `https://api.frankfurter.app/${rateDate}?from=${encodeURIComponent(
    sourceCurrency
  )}&to=USD`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    return {
      sourceCurrency,
      sourceAmount: amount,
      usdAmount: 0,
      rate: 0,
      rateDate,
      provider: "frankfurter",
      status: "lookup_failed",
    };
  }
  const json = (await res.json()) as { rates?: { USD?: number } };
  const rate = Number(json?.rates?.USD || 0);
  if (!rate) {
    return {
      sourceCurrency,
      sourceAmount: amount,
      usdAmount: 0,
      rate: 0,
      rateDate,
      provider: "frankfurter",
      status: "lookup_failed",
    };
  }
  return {
    sourceCurrency,
    sourceAmount: amount,
    usdAmount: amount * rate,
    rate,
    rateDate,
    provider: "frankfurter",
    status: "ok",
  };
}

const DIAGNOSIS_PROMPT = `You are helping suggest ICD-10-CM diagnosis codes for insurance claim review.
Given claim details, suggest up to 3 likely ICD-10-CM codes.
Return STRICT JSON with shape:
{
  "diagnosisSuggestions": [
    { "code": "string", "label": "string", "confidence": 0.0 }
  ]
}
Rules:
- Use ICD-10-CM format code strings.
- Confidence must be between 0 and 1.
- If uncertain, still provide best-effort suggestions with lower confidence.
- Return JSON only.`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Gemini API key not configured. Add GEMINI_API_KEY to .env.local" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const pdfFieldsRaw = formData.get("pdfFields");
    const pdfFields = typeof pdfFieldsRaw === "string" ? JSON.parse(pdfFieldsRaw) : [];

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";
    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
    ]);
    const text = result.response.text().trim();

    let cleaned = text;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const extracted = JSON.parse(cleaned);

    const claimData = {
      ...EMPTY_CLAIM,
      ...Object.fromEntries(
        Object.entries(extracted).filter(([key]) => key in EMPTY_CLAIM)
      ),
    };

    let mappingSuggestions: MappingSuggestion[] = [];
    let validationWarnings: ValidationWarning[] = [];
    let providerClassification: ProviderClassification | null = null;
    let fxConversion: FxConversion | null = null;
    let diagnosisSuggestions: DiagnosisSuggestion[] = [];

    claimData.claimType = sanitizeClaimType(claimData.claimType);

    providerClassification = heuristicProviderClassification(
      claimData.providerName,
      claimData.description
    );
    if (providerClassification.confidence < 0.75) {
      try {
        const lookedUp = await classifyProviderWithLookup(
          claimData.providerName,
          claimData.providerAddress
        );
        if (lookedUp) providerClassification = lookedUp;
      } catch {
        validationWarnings.push({
          code: "provider_lookup_failed",
          message:
            "Provider lookup could not be completed; classification used local heuristics.",
          severity: "info",
        });
      }
    }
    if (!claimData.claimType && providerClassification) {
      claimData.claimType = providerClassification.category;
    }
    const serviceText = `${claimData.description} ${claimData.providerName}`.toLowerCase();
    if (
      (!claimData.claimType || claimData.claimType === "other") &&
      /(outpatient|inpatient|hospital|emergency|clinic)/i.test(serviceText)
    ) {
      claimData.claimType = "hospital";
    }

    const inferredCurrency = inferCurrencyFromText(
      `${claimData.currency} ${claimData.providerAddress} ${claimData.description}`
    );
    if (!claimData.currency && inferredCurrency) {
      claimData.currency = inferredCurrency;
    }
    if (!claimData.serviceCountry && claimData.providerAddress) {
      const chunks = claimData.providerAddress.split(",").map((part) => part.trim()).filter(Boolean);
      if (chunks.length > 0) claimData.serviceCountry = chunks[chunks.length - 1];
    }
    if (!claimData.foreignProvider) {
      const hint = `${claimData.serviceCountry} ${claimData.currency}`.toLowerCase();
      claimData.foreignProvider =
        claimData.currency.toUpperCase() !== "USD" ||
        /(thailand|israel|japan|europe|france|spain|germany|uk|united kingdom|mexico|canada|australia)/i.test(
          hint
        )
          ? "yes"
          : "no";
    }
    const amount = parseNumber(claimData.amountCharged);
    if (!amount || !claimData.currency) {
      validationWarnings.push({
        code: "fx_missing_data",
        message:
          "USD conversion could not be prepared because amount or currency is missing.",
        severity: "warning",
      });
    } else {
      fxConversion = await convertToUsd(claimData.currency.toUpperCase(), amount, claimData.dateOfService);
      if (fxConversion.status === "ok") {
        claimData.amountUSD = fxConversion.usdAmount.toFixed(2);
      } else {
        validationWarnings.push({
          code: "fx_lookup_failed",
          message:
            "Historical FX lookup failed; verify USD amount manually before finalizing.",
          severity: "warning",
        });
      }
    }

    if (Array.isArray(pdfFields) && pdfFields.length > 0) {
      try {
        const mappingResult = await model.generateContent([
          `${MAPPING_PROMPT}\n\nclaimData:\n${JSON.stringify(claimData)}\n\npdfFields:\n${JSON.stringify(pdfFields)}`,
        ]);

        let mappingText = mappingResult.response.text().trim();
        if (mappingText.startsWith("```")) {
          mappingText = mappingText
            .replace(/^```(?:json)?\n?/, "")
            .replace(/\n?```$/, "");
        }

        const parsed = JSON.parse(mappingText);
        mappingSuggestions = Array.isArray(parsed?.mappingSuggestions)
          ? parsed.mappingSuggestions.filter(
              (m: MappingSuggestion) =>
                typeof m?.pdfFieldName === "string" &&
                typeof m?.claimDataKey === "string"
            )
          : [];
        validationWarnings = Array.isArray(parsed?.validationWarnings)
          ? parsed.validationWarnings.filter(
              (w: ValidationWarning) =>
                typeof w?.code === "string" &&
                typeof w?.message === "string"
            )
          : [];
      } catch {
        validationWarnings.push({
          code: "mapping_ai_failed",
          message:
            "AI-assisted form mapping could not be generated. Review mappings manually in Settings.",
          severity: "warning",
        });
      }
    }

    try {
      const diagnosisResult = await model.generateContent([
        `${DIAGNOSIS_PROMPT}\n\nclaimData:\n${JSON.stringify(claimData)}`,
      ]);
      let diagnosisText = diagnosisResult.response.text().trim();
      if (diagnosisText.startsWith("```")) {
        diagnosisText = diagnosisText
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "");
      }
      const parsed = JSON.parse(diagnosisText);
      diagnosisSuggestions = Array.isArray(parsed?.diagnosisSuggestions)
        ? parsed.diagnosisSuggestions
            .filter(
              (item: DiagnosisSuggestion) =>
                typeof item?.code === "string" &&
                typeof item?.label === "string" &&
                typeof item?.confidence === "number"
            )
            .slice(0, 3)
        : [];
    } catch {
      validationWarnings.push({
        code: "diagnosis_suggestion_failed",
        message:
          "Diagnosis suggestions could not be generated. You can enter ICD-10-CM manually.",
        severity: "info",
      });
    }

    if (
      providerClassification &&
      providerClassification.confidence < 0.75
    ) {
      validationWarnings.push({
        code: "classification_low_confidence",
        message:
          "Provider classification confidence is low. Review claim type before finalizing.",
        severity: "warning",
      });
    }

    return NextResponse.json({
      data: claimData,
      mappingSuggestions,
      validationWarnings,
      providerClassification,
      fxConversion,
      diagnosisSuggestions,
    });
  } catch (error) {
    console.error("Extraction error:", error);
    const errorObj = error as {
      message?: string;
      status?: number;
      code?: number | string;
    };
    const formatted = formatGeminiError(errorObj);
    return NextResponse.json({ error: formatted.message }, { status: formatted.status });
  }
}
