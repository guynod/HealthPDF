# HealthPDF

HealthPDF is a local-first Next.js tool for turning medical receipts or invoices into filled health insurance claim PDFs.

## What It Does

- Stores your claim form template in browser IndexedDB.
- Stores profile defaults and field mappings in browser localStorage.
- Exports/imports a portable private config bundle with the template, profile defaults, PDF fields, and mappings.
- Extracts receipt/invoice data through the local `/api/extract` route using Gemini.
- Fills editable or flattened claim PDFs with `pdf-lib`.
- Appends the source receipt/invoice pages to the generated claim packet.
- Opens an email draft with the claim metadata so you can attach the generated PDF manually.

## Privacy Model

This app handles health and insurance data. Treat it as private.

- `.env.local` is ignored by git and should contain your Gemini key.
- Profile defaults, mappings, and templates stay in your browser storage.
- Portable config exports include private profile data and the claim template. Store them like private insurance documents.
- Uploaded receipts/invoices are sent to Gemini for extraction when you run the app.
- Provider-address lookup is disabled by default because it would send provider names/addresses to OpenStreetMap Nominatim.
- FX lookup sends currency/date only to Frankfurter when a non-USD conversion is needed.
- Do not commit real claim PDFs, receipts, screenshots, exports, or generated packets.

## Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Required environment:

```bash
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-2.5-flash
```

Optional environment:

```bash
HEALTHPDF_MAX_UPLOAD_MB=15
HEALTHPDF_ENABLE_PROVIDER_LOOKUP=false
```

Set `HEALTHPDF_ENABLE_PROVIDER_LOOKUP=true` only if you accept sending provider names/addresses to OpenStreetMap Nominatim for classification help.

## Workflow

1. Open Settings.
2. Fill your profile/email defaults.
3. Upload the insurer's fillable PDF claim form.
4. Review or adjust field mappings.
5. Export a portable config if you need to move this setup to another browser or approved private automation environment.
6. Upload a receipt/invoice.
7. Review extracted data, warnings, diagnosis code, claim type, and USD conversion.
8. Generate an editable PDF first.
9. Finalize and flatten only after the editable PDF looks right.
10. Download the PDF, open the email draft, attach the PDF manually, and send.

## Checks

```bash
npm run lint
npm run build
npm test
```

The automated test suite covers upload guards, warning preservation, PDF field transforms, email/template interpolation, dummy PDF packet generation, and portable config validation.

## Local CLI

After exporting a portable config from Settings, you can generate packets from explicit claim data without opening the browser:

```bash
npm run claim -- \
  --config /path/to/healthpdf-geha-config.json \
  --input-pdf /path/to/receipt-or-invoice.pdf \
  --claim-data /path/to/claim-data.json \
  --out-dir /path/to/output \
  --claim-id optional-claim-id \
  --json
```

The CLI does not extract receipt text, call Gemini, send email, use Telegram, or update Notion. It writes an editable packet whenever possible, writes a finalized packet only when required fields are complete, and records a manifest next to the output PDFs.

## TARS Integration Recommendation

Keep the real claim data local. If this becomes part of the TARS system, use TARS only for metadata tracking, for example:

- claim packet generated
- insurer submitted to
- follow-up date
- reimbursement received
- open blockers

Do not give TARS claim PDFs, receipts, member IDs, diagnosis text, or generated packets unless you make a separate explicit privacy decision. For approved mobile claim automation, export a portable config bundle and store it only in TARS private storage.
