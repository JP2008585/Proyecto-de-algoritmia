const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || "demo-google-client-id");
const USERS_FILE = path.join(__dirname, "data", "users.json");

async function ensureUsersFile() {
  try {
    await fs.promises.mkdir(path.dirname(USERS_FILE), { recursive: true });
    await fs.promises.access(USERS_FILE);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.writeFile(USERS_FILE, "[]", "utf8");
    } else {
      throw error;
    }
  }
}

async function leerUsuarios() {
  await ensureUsersFile();
  const contenido = await fs.promises.readFile(USERS_FILE, "utf8");
  const usuarios = JSON.parse(contenido || "[]");
  return Array.isArray(usuarios) ? usuarios : [];
}

async function guardarUsuarios(usuarios) {
  await ensureUsersFile();
  await fs.promises.writeFile(USERS_FILE, JSON.stringify(usuarios, null, 2), "utf8");
}

const db = {
  async buscarUsuarioPorEmail(email) {
    const usuarios = await leerUsuarios();
    const correo = String(email || "").trim().toLowerCase();
    return usuarios.find((usuario) => usuario.email.toLowerCase() === correo) || null;
  },
  async buscarUsuarioPorId(id) {
    const usuarios = await leerUsuarios();
    return usuarios.find((usuario) => usuario.id === id) || null;
  },
  async crearUsuario({ nombre, email, passwordHash, googleId }) {
    const usuarios = await leerUsuarios();
    const nuevoUsuario = {
      id: `user_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
      nombre: nombre?.trim(),
      email: String(email || "").trim().toLowerCase(),
      passwordHash: passwordHash || null,
      googleId: googleId || null,
      createdAt: new Date().toISOString(),
      subjects: [],
      recommendations: [],
      timer: { seconds: 0, running: false, endAt: null }
    };

    usuarios.push(nuevoUsuario);
    await guardarUsuarios(usuarios);
    return nuevoUsuario;
  }
};

function normalizarTimer(timer) {
  const valor = timer && typeof timer === "object" ? timer : {};
  const seconds = Number(valor.seconds) || 0;

  return {
    seconds: Math.max(0, Number.isFinite(seconds) ? seconds : 0),
    running: Boolean(valor.running),
    endAt: valor.endAt && Number(valor.endAt) > 0 ? Number(valor.endAt) : null
  };
}

function normalizarDatosUsuario(value) {
  const datos = value && typeof value === "object" ? value : {};

  return {
    subjects: Array.isArray(datos.subjects) ? datos.subjects : [],
    recommendations: Array.isArray(datos.recommendations) ? datos.recommendations : [],
    timer: normalizarTimer(datos.timer)
  };
}

async function obtenerDatosCompletosUsuario(id) {
  const usuario = await db.buscarUsuarioPorId(id);
  if (!usuario) {
    return null;
  }

  const datos = normalizarDatosUsuario({
    subjects: usuario.subjects,
    recommendations: usuario.recommendations,
    timer: usuario.timer
  });

  usuario.subjects = datos.subjects;
  usuario.recommendations = datos.recommendations;
  usuario.timer = datos.timer;

  return usuario;
}

async function guardarDatosUsuario(id, datos) {
  const usuarios = await leerUsuarios();
  const posicion = usuarios.findIndex((usuario) => usuario.id === id);

  if (posicion === -1) {
    return null;
  }

  const usuario = usuarios[posicion];
  const normalizados = normalizarDatosUsuario(datos);

  usuario.subjects = normalizados.subjects;
  usuario.recommendations = normalizados.recommendations;
  usuario.timer = normalizados.timer;

  await guardarUsuarios(usuarios);
  return usuario;
}

function obtenerUsuarioDesdeToken(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    throw new Error("Token requerido");
  }

  const secret = process.env.JWT_SECRET || "studytrack-development-secret";
  return jwt.verify(token, secret);
}

function generarToken(usuario) {
  const secret = process.env.JWT_SECRET || "studytrack-development-secret";

  return jwt.sign(
    { id: usuario.id, email: usuario.email },
    secret,
    { expiresIn: "7d" }
  );
}

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, career, subjectsCount } = req.body;
    const parsedSubjectsCount = Number(subjectsCount);

    if (!String(name || "").trim() || !String(email || "").trim() || !password ||
        !String(career || "").trim() || !Number.isInteger(parsedSubjectsCount)) {
      return res.status(400).json({ message: "Faltan campos por completar" });
    }

    if (parsedSubjectsCount < 1 || parsedSubjectsCount > 20) {
      return res.status(400).json({ message: "La cantidad de materias debe estar entre 1 y 20" });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "La contraseña debe tener al menos 6 caracteres"
      });
    }

    const existente = await db.buscarUsuarioPorEmail(email);
    if (existente) {
      return res.status(409).json({ message: "Ya existe una cuenta con ese correo" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const nuevoUsuario = await db.crearUsuario({
      nombre: name,
      email,
      passwordHash
    });
    nuevoUsuario.career = String(career).trim();
    nuevoUsuario.subjectsCount = parsedSubjectsCount;
    const usuarios = await leerUsuarios();
    const usuarioGuardado = usuarios.find((usuario) => usuario.id === nuevoUsuario.id);
    usuarioGuardado.career = nuevoUsuario.career;
    usuarioGuardado.subjectsCount = parsedSubjectsCount;
    await guardarUsuarios(usuarios);

    const token = generarToken(nuevoUsuario);
    return res.status(201).json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error al crear la cuenta" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Correo y contraseña son obligatorios" });
    }

    const usuario = await db.buscarUsuarioPorEmail(email);
    if (!usuario || !usuario.passwordHash) {
      return res.status(401).json({ message: "Correo o contraseña incorrectos" });
    }

    const esValida = await bcrypt.compare(password, usuario.passwordHash);
    if (!esValida) {
      return res.status(401).json({ message: "Correo o contraseña incorrectos" });
    }

    const token = generarToken(usuario);
    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Error al iniciar sesión" });
  }
});

router.get("/profile", async (req, res) => {
  try {
    const tokenUser = obtenerUsuarioDesdeToken(req);
    const usuario = await db.buscarUsuarioPorId(tokenUser.id);

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    return res.json({
      name: usuario.nombre || "",
      email: usuario.email,
      university: usuario.university || "",
      career: usuario.career || "",
      subjectsCount: Number(usuario.subjectsCount) || 6
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "Sesión no válida" });
  }
});

router.get("/data", async (req, res) => {
  try {
    const tokenUser = obtenerUsuarioDesdeToken(req);
    const usuario = await obtenerDatosCompletosUsuario(tokenUser.id);

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    return res.json({
      subjects: usuario.subjects || [],
      recommendations: usuario.recommendations || [],
      timer: usuario.timer || { seconds: 0, running: false, endAt: null }
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "Sesión no válida" });
  }
});

router.put("/data", async (req, res) => {
  try {
    const tokenUser = obtenerUsuarioDesdeToken(req);
    const datos = normalizarDatosUsuario(req.body || {});
    const usuario = await guardarDatosUsuario(tokenUser.id, datos);

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    return res.json({
      subjects: usuario.subjects || [],
      recommendations: usuario.recommendations || [],
      timer: usuario.timer || { seconds: 0, running: false, endAt: null }
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "No se pudieron guardar los datos del usuario" });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const tokenUser = obtenerUsuarioDesdeToken(req);
    const usuarios = await leerUsuarios();
    const usuario = usuarios.find((item) => item.id === tokenUser.id);

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const { name, university, career } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: "El nombre es obligatorio" });
    }

    usuario.nombre = String(name).trim();
    usuario.university = String(university || "").trim();
    usuario.career = String(career || "").trim();
    await guardarUsuarios(usuarios);

    return res.json({ message: "Perfil actualizado correctamente" });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "No se pudo actualizar el perfil" });
  }
});

router.delete("/profile", async (req, res) => {
  try {
    const tokenUser = obtenerUsuarioDesdeToken(req);
    const usuarios = await leerUsuarios();
    const remainingUsers = usuarios.filter((usuario) => usuario.id !== tokenUser.id);

    if (remainingUsers.length === usuarios.length) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    await guardarUsuarios(remainingUsers);
    return res.json({ message: "Cuenta eliminada correctamente" });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "No se pudo eliminar la cuenta" });
  }
});

router.put("/password", async (req, res) => {
  try {
    const tokenUser = obtenerUsuarioDesdeToken(req);
    const usuarios = await leerUsuarios();
    const usuario = usuarios.find((item) => item.id === tokenUser.id);

    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Completa ambas contraseñas" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "La nueva contraseña debe tener al menos 6 caracteres" });
    }
    if (!usuario.passwordHash) {
      return res.status(400).json({ message: "Esta cuenta no tiene contraseña local configurada" });
    }

    const validPassword = await bcrypt.compare(currentPassword, usuario.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ message: "La contraseña actual no es correcta" });
    }

    usuario.passwordHash = await bcrypt.hash(newPassword, 10);
    await guardarUsuarios(usuarios);
    return res.json({ message: "Contraseña actualizada correctamente" });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "No se pudo cambiar la contraseña" });
  }
});

router.post("/google", async (req, res) => {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({ message: "Falta el token de Google" });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(400).json({ message: "Google login no está configurado" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    let usuario = await db.buscarUsuarioPorEmail(email);
    if (!usuario) {
      usuario = await db.crearUsuario({ nombre: name, email, googleId });
    }

    const token = generarToken(usuario);
    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "No se pudo verificar la cuenta de Google" });
  }
});

module.exports = router;
