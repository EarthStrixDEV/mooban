import http from 'node:http';
import express from 'express';
import { config } from './src/config.js';
import { pool } from './src/db.js';
import { baseHeaders, dispatch, errorHandler } from './src/http.js';
import * as spa from './src/spa.js';
import * as comments from './src/routes/comments.js';
import * as likes from './src/routes/likes.js';
import * as images from './src/routes/images.js';
import * as media from './src/media.js';
import * as ping from './src/routes/ping.js';
import * as posts from './src/routes/posts.js';
import * as stream from './src/routes/stream.js';
import * as testRoutes from './src/routes/test.js';
import * as tools from './src/routes/tools.js';
import * as users from './src/routes/users.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY ? 1 : false); // exactly one proxy hop

app.use(baseHeaders);

ping.register();
users.register();
posts.register();
likes.register();
images.register();
comments.register();
tools.register();
stream.register();
testRoutes.register();
app.all(/^\/(api|download|upload|cache)(\/|$)/, dispatch);

app.use('/media', media.handler());
spa.mount(app);
app.use(errorHandler);

const server = http.createServer(app);
server.listen(config.PORT, () => {
  console.log(`mooban (${config.APP_STACK}) listening on :${config.PORT}`);
});

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
