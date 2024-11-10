/**
 * Script de inicialização do bot.
 *
 * Este script é responsável por iniciar a conexão com o WhatsApp.
 *
 * Não é recomendado alterar este arquivo, a menos que você saiba o que está fazendo.
 *
 * Dev Gui </>
 */
const { question, onlyNumbers } = require("./utils");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidStatusBroadcast,
  proto,
  makeInMemoryStore,
  isJidNewsletter,
} = require("baileys");
const NodeCache = require("node-cache");
const pino = require("pino");
const {
  warningLog,
  infoLog,
  errorLog,
  sayLog,
  successLog,
} = require("./utils/logger");
const { BAILEYS_CREDS_DIR } = require("./config");
const { runLite } = require(".");

const msgRetryCounterCache = new NodeCache();

const store = makeInMemoryStore({
  logger: pino().child({ level: "silent", stream: "store" }),
});

async function getMessage(key) {
  if (!store) {
    return proto.Message.fromObject({});
  }

  const msg = await store.loadMessage(key.remoteJid, key.id);

  return msg ? msg.message : undefined;
}

async function startConnection() {
  const { state, saveCreds } = await useMultiFileAuthState(BAILEYS_CREDS_DIR);

  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    logger: pino({ level: "error" }),
    printQRInTerminal: false,
    defaultQueryTimeoutMs: 60 * 1000,
    auth: state,
    shouldIgnoreJid: (jid) =>
      isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid),
    keepAliveIntervalMs: 60 * 1000,
    markOnlineOnConnect: true,
    msgRetryCounterCache,
    shouldSyncHistoryMessage: () => false,
    getMessage,
  });

  if (!socket.authState.creds.registered) {
    warningLog("Credenciais ainda não configuradas!");

    infoLog('Informe o seu número de telefone (exemplo: "5511920202020"):');

    const phoneNumber = await question("Informe o seu número de telefone: ");

    if (!phoneNumber) {
      errorLog(
        'Número de telefone inválido! Tente novamente com o comando "yarn start".'
      );

      process.exit(1);
    }

    const code = await socket.requestPairingCode(onlyNumbers(phoneNumber));

    sayLog(`Código de pareamento: ${code}`);
  }

  socket.ev.process(async (events) => {
    if (events["connection.update"]) {
      const update = events["connection.update"];
      const { connection, lastDisconnect } = update;

      if (connection === "close") {
        const statusCode =
          lastDisconnect.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        if (statusCode === DisconnectReason.loggedOut) {
          errorLog("Bot desconectado!");
        } else {
          switch (statusCode) {
            case DisconnectReason.badSession:
              warningLog("Sessão inválida!");
              break;
            case DisconnectReason.connectionClosed:
              warningLog("Conexão fechada!");
              break;
            case DisconnectReason.connectionLost:
              warningLog("Conexão perdida!");
              break;
            case DisconnectReason.connectionReplaced:
              warningLog("Conexão substituída!");
              break;
            case DisconnectReason.multideviceMismatch:
              warningLog("Dispositivo incompatível!");
              break;
            case DisconnectReason.forbidden:
              warningLog("Conexão proibida!");
              break;
            case DisconnectReason.restartRequired:
              infoLog('Me reinicie por favor! Digite "npm start".');
              break;
            case DisconnectReason.unavailableService:
              warningLog("Serviço indisponível!");
              break;
          }

          startConnection().then(({ socket, events }) => {
            runLite({ socket, events });
          });
        }
      } else if (connection === "open") {
        successLog("Fui conectado com sucesso!");
      } else {
        infoLog("Atualizando conexão...");
      }
    }

    if (events["creds.update"]) {
      await saveCreds();
    }
  });

  return { socket, events };
}

startConnection().then(({ socket, events }) => {
  runLite({ socket, events });
});
