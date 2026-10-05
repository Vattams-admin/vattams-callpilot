# VATTAMS CallPilot

VATTAMS CallPilot is a React + TypeScript web application for preparing approved business-call requests and presenting a simulated call lifecycle. It is currently a demo product: it does **not** place real phone calls.

## Stack

- React 19 + TypeScript + Vite
- Firebase Authentication
- Firebase callable Cloud Functions
- Firebase Secret Manager
- Mappls business discovery
- Oxlint + TypeScript production builds
- GitHub Actions CI

## Security model

- Firebase Authentication is required for business discovery.
- Firestore client access is intentionally denied; server-side callable functions are the trusted application boundary.
- Mappls OAuth credentials stay server-side in Firebase Secret Manager.
- No Mappls credentials are exposed through VITE_ frontend variables.
- The frontend calls mapplsProxy through Firebase's authenticated callable protocol.

## Mappls configuration

Store the production credentials in Firebase Secret Manager:

```bash
firebase functions:secrets:set MAPPLS_CLIENT_ID
firebase functions:secrets:set MAPPLS_CLIENT_SECRET
```

Deploy the callable function with:

```bash
firebase deploy --only functions:mapplsProxy
```

The function runs in asia-south1, matching the project's Firestore region.

For local frontend configuration, copy .env.local.example to .env.local and provide the Firebase web configuration values. Never commit .env.local.

## Development

```bash
npm ci
npm run lint
npm run build
npm run dev
```

For Cloud Functions:

```bash
cd functions
npm ci
npm run build
```

## CI

The public repository runs GitHub Actions on pushes and pull requests targeting main.

CI verifies:

1. Frontend dependency installation
2. Frontend lint
3. Frontend production build
4. Cloud Functions dependency installation
5. Cloud Functions TypeScript build
