const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
// const LdapAuth = require("ldapauth-fork");
const path = require("path");
const pino = require("pino");

const logger = pino({ level: "info" });

const app = express();
const upload = multer({ dest: "uploads/" });

// ===== CONFIG =====
const OWNER = process.env.OWNER;
const REPO = process.env.REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const MAX_SIZE_MB = parseInt(process.env.MAX_SIZE_MB || "500");
const ALLOWED_EXT = (process.env.ALLOWED_EXT || ".bin,.exe").split(",");

// ===== LDAP =====
// const ldap = new LdapAuth({
//   url: process.env.LDAP_URL,
//   bindDN: process.env.LDAP_BIND_DN,
//   bindCredentials: process.env.LDAP_BIND_PASSWORD,
//   searchBase: process.env.LDAP_SEARCH_BASE,
//   searchFilter: process.env.LDAP_SEARCH_FILTER,
//   reconnect: true
// });

// ===== MIDDLEWARE =====
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: "segredo-forte",
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect("/login.html");
}

// ===== VALIDAÇÃO =====
function validateFile(file) {
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > MAX_SIZE_MB) {
    throw new Error(`Arquivo maior que ${MAX_SIZE_MB}MB`);
  }

  const name = file.originalname.toLowerCase();
  if (!ALLOWED_EXT.some(ext => name.endsWith(ext))) {
    throw new Error("Extensão não permitida");
  }
}

// ===== ROTAS =====
// app.post("/login", (req, res) => {
//   const { username, password } = req.body;

//   ldap.authenticate(username, password, (err, user) => {
//     if (err || !user) {
//       logger.error({ err }, "Falha no login LDAP");
//       return res.redirect("/login.html?error=1");
//     }

//     req.session.user = { username };
//     logger.info({ username }, "Login bem-sucedido");

//     return res.redirect("/upload.html");
//   });
// });

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    logger.warn("Tentativa de login sem usuário ou senha");
    return res.redirect("/login.html?error=1");
  }

  req.session.user = { username };
  logger.info({ username }, "Login fake bem-sucedido");

  return res.redirect("/upload.html");
});


app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login.html"));
});

app.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    validateFile(req.file);

    const filePath = req.body.path;
    const branch = req.body.branch;
    const file = req.file;

    const content = fs.readFileSync(file.path, { encoding: "base64" });

    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${filePath}`;

    let sha = undefined;
    try {
      const existing = await axios.get(url, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
        params: { ref: branch }
      });
      sha = existing.data.sha;
    } catch {}

    await axios.put(
      url,
      {
        message: `Upload via portal (user: ${req.session.user.username})`,
        content,
        branch,
        sha
      },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    fs.unlinkSync(file.path);

    logger.info({
      user: req.session.user.username,
      path: filePath,
      branch
    }, "Upload concluído");

    res.send("Upload concluído com sucesso");
  } catch (err) {
    logger.error({ err }, "Erro no upload");
    res.status(500).send("Erro no upload");
  }
});

app.listen(3000, () => logger.info("Portal rodando na porta 3000"));
