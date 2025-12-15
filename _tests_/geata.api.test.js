const request = require("supertest");
const { app, initDb } = require("../index");

beforeAll(async () => {
  await initDb();
});

const adminKey = process.env.ADMIN_API_KEY;

function adminHeaders() {
  return { "x-api-key": adminKey, "Content-Type": "application/json" };
}

async function registerAndLogin() {
  const email = `test_${Date.now()}@example.com`;
  const password = "Passw0rd!";

  const reg = await request(app)
    .post("/auth/register")
    .send({ name: "Test User", email, password });

  expect([201, 409]).toContain(reg.status);

  const login = await request(app)
    .post("/auth/login")
    .send({ email, password });

  expect(login.status).toBe(200);
  return { token: login.body.token, user: login.body.user, email, password };
}

describe("Geata API (Postgres)", () => {
  test("GET / health works", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(String(res.text)).toMatch(/Geata API is running/i);
  });

  test("GET /devices requires admin key", async () => {
    const res = await request(app).get("/devices");
    expect(res.status).toBe(401);
  });

  test("Admin can list devices with key", async () => {
    const res = await request(app).get("/devices").set("x-api-key", adminKey);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("User login + /me works with token", async () => {
    const { token } = await registerAndLogin();

    const me = await request(app)
      .get("/me")
      .set("authorization", "Bearer " + token);

    expect(me.status).toBe(200);
    expect(me.body.id).toBeTruthy();
  });

  test("Unassigned user cannot open a gate (403 or 404)", async () => {
    const { token } = await registerAndLogin();

    const res = await request(app)
      .post("/devices/gate1/open")
      .set("authorization", "Bearer " + token)
      .send({ durationMs: 1000 });

    // If gate1 exists -> 403. If gate1 doesn't -> 404.
    expect([403, 404]).toContain(res.status);
  });
});
