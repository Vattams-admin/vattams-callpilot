# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Mappls server-side setup

Business discovery now runs through the `mapplsProxy` Firebase Cloud Function. The browser does not call Mappls directly and does not contain Mappls credentials.

Mappls Text Search and Nearby APIs use OAuth2. The function obtains an access token with Mappls `client_id` + `client_secret`, then calls the Mappls REST APIs server-side. Configure the production credentials with Firebase Secret Manager (never put them in `VITE_` variables):

```bash
firebase functions:secrets:set MAPPLS_CLIENT_ID
firebase functions:secrets:set MAPPLS_CLIENT_SECRET
```

Then deploy the function:

```bash
firebase deploy --only functions:mapplsProxy
```

The function is deployed to `asia-south1`, matching the project's Firestore region.
