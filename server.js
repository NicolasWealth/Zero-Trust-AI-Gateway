import 'dotenv/config';
import { createAppFromEnv } from './app.js';

const port = Number(process.env.PORT) || 3000;
createAppFromEnv().listen(port, () => console.log(`Gateway listening on port ${port}`));
