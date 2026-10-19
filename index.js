const fs = require("fs-extra");
const P = require("pino");
const express = require("express");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  delay
} = require("@whiskeysockets/baileys");

const { handleCommand } = require("./lib/case");
const { storeMessage, handleMessageRevocation, setBotId } = require("./lib/commands/antidelete");
const { handleAntilink } = require("./lib/commands/antilink");
const { loadSettings } = require("./lib/setting");

const app = express();

// ✅ HACKER-MD Settings - 41 Commands Config Load
const config = loadSettings();
global.settings = {
  ownerNumber: config.ownerNumber,
  ownerName: config.ownerName,
  botName: config.botName,
  mode: config.mode,
  prefix: config.prefix,
  ANTIDELETE: config.ANTIDELETE,
  signature: config.signature
};

// ✅ Global Toggles - All 41 Commands
global.sock = null;
global.mode = config.mode || "private";
global.autoreact = config.autoReact || false;
global.autostatus = config.autoStatusView || false;
global.autoStatus = config.autoStatusView || false;
global.autotyping = config.autoTyping || false;
global.autoTyping = config.autoTyping || false;
global.autoseen = config.autoSeen || false;
global.autoSeen = config.autoSeen || false;
global.autorecording = config.autoRecording || false;
global.autoRecording = config.autoRecording || false;
global.autogreet = {};
global.antilinkick = config.antiLinkKick || false;
global.warns = {};
global.warnSettings = {};
global.bannedUsers = [];

app.get('/', (req,res) => res.sendFile(path.join(__dirname,'index.html')));

// ✅ PAIR API - FIXED FOR RENDER
app.get('/api/pair', async (req,res) => {
  let num = (req.query.number||'').replace(/[^0-9]/g,'');
  if(!num) return res.json({code: "NO NUMBER - Use?number=923xxxxxxxx"});

  try{
    if(!fs.existsSync('./session')) fs.mkdirSync('./session');
    const { state, saveCreds } = await useMultiFileAuthState(`./session/${num}`);
    const sock = makeWASocket({
      auth: state,
      logger: P({level:'silent'}),
      browser: ["HACKER-MD","Chrome","1.0"],
      printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);
    await delay(2000);

    if(!state.creds.registered){
      await delay(1500);
      let code = await sock.requestPairingCode(num);
      console.log(`\n✅ PAIR CODE FOR ${num}: ${code}\n`);
      return res.json({code});
    }

    return res.json({code: "ALREADY PAIRED 💀 - Bot online hai"});

  }catch(e){
    console.log("Pair Error:", e.message);
    return res.json({code: "SERVER BUSY - Try again: " + e.message});
  }
});

async function startBotForSession(sessionFolder) {
  const { state, saveCreds } = await useMultiFileAuthState(`./session/${sessionFolder}`);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    browser: ["HACKER-MD","Chrome","1.0"],
    markOnlineOnConnect: true
  });

  global.sock = sock;
  setBotId(sock);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      console.log(`✅ [HACKER-MD ONLINE] ${sessionFolder} - 41 CMDS LOADED 💀`);
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`❌ Connection closed for ${sessionFolder}: ${statusCode}`);
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log(`🔄 Reconnecting ${sessionFolder} in 3 sec...`);
        setTimeout(() => startBotForSession(sessionFolder), 3000);
      } else {
        console.log(`🗑️ Session ${sessionFolder} logged out`);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if(!msg?.message) return;
    const jid = msg.key.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || "";

    try { storeMessage(msg); } catch {}
    if (msg.message?.protocolMessage?.type === 0) {
      try { await handleMessageRevocation(sock, msg); } catch {}
      return;
    }
    try { await handleAntilink(sock, msg, jid); } catch {}

    if ((global.autoreact || global.autoReact) && jid !== "status@broadcast" && !msg.key.fromMe) {
      try {
        const hearts = ["❤️","☣️","😘","😂","😍","😭","💀","😎","💞","🎭","😡","🥺","😈","🥳","💗","🚩","⚠️","💝","👍","🙌"];
        const randomHeart = hearts[Math.floor(Math.random() * hearts.length)];
        await sock.sendMessage(jid, { react: { text: randomHeart, key: msg.key } });
      } catch {}
    }

    if ((global.autotyping || global.autoTyping) && jid !== "status@broadcast" && !msg.key.fromMe) {
      try { await sock.sendPresenceUpdate('composing', jid); await delay(1000); } catch {}
    }
    if ((global.autorecording || global.autoRecording) && jid !== "status@broadcast" && !msg.key.fromMe) {
      try { await sock.sendPresenceUpdate('recording', jid); await delay(1000); } catch {}
    }
    if ((global.autoseen || global.autoSeen) && jid !== "status@broadcast") {
      try { await sock.readMessages([msg.key]); } catch {}
    }
    if ((global.autostatus || global.autoStatus) && jid === "status@broadcast") {
      try {
        await sock.readMessages([{ remoteJid: jid, id: msg.key.id, participant: msg.key.participant }]);
        console.log(`📊 Auto viewed status: ${msg.key.participant}`);
      } catch (e) { console.log("AutoStatus Error:", e.message) }
      return;
    }

    if(!text.startsWith('.')) return;
    try { await handleCommand(sock, msg); } catch(e){ console.log("Case Error:", e.message) }
  });

  sock.ev.on("group-participants.update", async (update) => {
    const { id, participants, action } = update;
    if (!global.autogreet?.[id]) return;
    try {
      const metadata = await sock.groupMetadata(id);
      const memberCount = metadata.participants.length;
      const groupName = metadata.subject || "Unnamed Group";
      for (const user of participants) {
        const tag = `@${user.split("@")[0]}`;
        let message = "";
        if (action === "add") {
          message = `┏━━━🔥༺ 𓆩💀𓆪 ༻🔥━━━┓\n 💠 *WELCOME WORLD* 💠\n┗━━━🔥༺ 𓆩💀𓆪 ༻🔥━━━┛\n\n👹 *Hey ${tag}, Welcome to* \n『 ${groupName} 』\n\n⚡ *Current Members:* ${memberCount}\n💀 *HACKER-MD welcomes you with POWER* ⚡`;
        } else if (action === "remove") {
          message = `💔 ${tag} *has left the battlefield...*\n⚡ *Now only ${memberCount - 1} members remain in ${groupName}*`;
        }
        if (message) await sock.sendMessage(id, { text: message, mentions: [user] });
      }
    } catch {}
  });
}

async function startAllBots(){
  if(!fs.existsSync('./session')) fs.mkdirSync('./session');
  const files = fs.readdirSync('./session');
  if(files.length === 0) {
    console.log("⚠️ No sessions found - Pair via /api/pair?number=923xxxxxxxx");
  }
  for(let f of files){
    const fullPath = path.join('./session', f);
    if(fs.lstatSync(fullPath).isDirectory() || f.includes('@')) {
      startBotForSession(f);
    } else if (f === 'creds.json') {
      startBotForSession('');
    }
  }
  if(files.includes('creds.json')) startBotForSession('');
}

startAllBots();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n🚀 HACKER-MD Running on ${PORT} - 41 Commands Loaded 💀\nPair API: /api/pair?number=923xxx\n`));