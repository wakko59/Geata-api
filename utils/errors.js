// utils/errors.js
export function notFound(res, entity = "resource") {
  return res.status(404).json({ error: `${entity} not found` });
}

export function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}
