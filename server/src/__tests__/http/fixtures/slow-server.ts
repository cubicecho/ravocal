// Run as its own process by shutdown.test.ts, so the signal and the exit it causes are real.
import { createServer } from 'node:http';
import { stopOnSignals } from '../../../http/shutdown.ts';

/** How long a request takes to answer. Well inside HTTP_DEFAULTS.drainSeconds. */
const RESPONSE_DELAY_MS = 300;

const server = createServer((_req, res) => {
  console.log('request received');
  setTimeout(() => res.end('finished'), RESPONSE_DELAY_MS);
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : '';
  console.log(`listening on ${port}`);
});

stopOnSignals(server, {
  after: async () => {
    console.log('closed what requests used');
  },
});
