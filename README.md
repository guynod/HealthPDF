# HealthPDF

HealthPDF is a local-first Next.js tool for turning medical receipts or invoices into filled health insurance claim PDFs.

## What It Does

- Stores your claim form template in browser IndexedDB.
- Stores profile defaults and field mappings in browser localStorage.
- Extracts receipt/invoice data through the local `/api/extract` route using Gemini.
- Fills editable or flattened claim PDFs with `pdf-lib`.
- Appends the source receipt/invoice pages to the generated claim packet.
- Opens an email draft with the claim metadata so you can attach the generated PDF manually.

## Privacy Model

This app handles health and insurance data. Treat it as private.

- `.env.local` is ignored by git and should contain your Gemini key.
- Profile defaults, mappings, and templates stay in your browser storage.
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
5. Upload a receipt/invoice.
6. Review extracted data, warnings, diagnosis code, claim type, and USD conversion.
7. Generate an editable PDF first.
8. Finalize and flatten only after the editable PDF looks right.
9. Download the PDF, open the email draft, attach the PDF manually, and send.

## Checks

```bash
npm run lint
npm run build
```

There is not yet an automated test suite. Good next tests would cover upload guards, warning preservation, PDF field transforms, and email/template interpolation.

## TARS Integration Recommendation

Keep the real claim data local. If this becomes part of the TARS system, use TARS only for metadata tracking, for example:

- claim packet generated
- insurer submitted to
- follow-up date
- reimbursement received
- open blockers

Do not give TARS claim PDFs, receipts, member IDs, diagnosis text, or generated packets unless you make a separate explicit privacy decision.
