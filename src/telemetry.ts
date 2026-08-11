import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
sdk.start();
const shutdown = async () => { await sdk.shutdown(); };
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
