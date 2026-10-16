// Vercel serverless entry. Vercel runs this file as a function; the Express app handles the request.
import { createAppFromEnv } from '../app.js';

export default createAppFromEnv();
