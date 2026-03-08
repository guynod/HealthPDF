import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { EMPTY_CLAIM, MappingSuggestion, ValidationWarning } from "@/lib/types";

const EXTRACTION_PROMPT = `You are a medical receipt/invoice data extraction assistant. Analyze the provided document and extract the following information. If the document is in a language other than English, translate all values into English.

Return a JSON object with exactly these fields:
- providerName: The name of the healthcare provider, clinic, or hospital
- providerAddress: The full address of the provider
- dateOfService: The date the service was provided (format: YYYY-MM-DD)
- description: A brief description of the medical service(s) provided
- diagnosis: The diagnosis or reason for visit, if mentioned
- amountCharged: The total amount charged (numbers only, no currency symbol)
- currency: The 3-letter currency code (e.g., USD, EUR, ILS, JPY)
- receiptNumber: The invoice or receipt number
- memberId: Member/subscriber ID if present
- insuranceGroup: Insurance group number/name if present
- gender: "male", "female", or empty string

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

    return NextResponse.json({
      data: claimData,
      mappingSuggestions,
      validationWarnings,
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
