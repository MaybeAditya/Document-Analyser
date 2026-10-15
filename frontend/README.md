# Document Analyst — Frontend

React + Vite interface for Document Analyst. For full-stack architecture, local development, environment variables, API details, and deployment steps, see the [root README](../README.md).

Local development:

```bash
cp .env.example .env
npm install
npm run dev
```

Set `VITE_API_BASE_URL` to the backend origin. The `VITE_` prefix means this value is bundled into client-side code; never put API secrets in frontend environment variables.
