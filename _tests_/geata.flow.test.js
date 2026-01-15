const request = require("supertest");
const { app, initDb } = require("../index");

beforeAll(async () => {
  await initDb();
});

const adminKey = process.env.ADMIN_API_KEY;

function adminHeaders() {
  return { "x-api-key": adminKey, "Content-Type": "application/json" };
}

async function createDevice(deviceId) {
  await request(app)
    .post("/devices")
    .set(adminHeaders())
    .send({ id: deviceId, name: "Test Gate " + deviceId });
}

async function registerAndLogin() {
  const email = `flow_${Date.now()}@example.com`;
  const password = "Passw0rd!";
  await request(app)
    .post("/auth/register")
    .send({ name: "Flow User", email, password });
  const login = await request(app)
    .post("/auth/login")
    .send({ email, password });
  return { token: login.body.token, user: login.body.user };
}

describe("Geata command lifecycle", () => {
  test("Attach user -> OPEN -> poll -> complete", async () => {
    const deviceId = "flow_gate_" + Date.now();
    await createDevice(deviceId);

    const { token, user } = await registerAndLogin();

    // attach user to device
    const attach = await request(app)
      .post(`/devices/${encodeURIComponent(deviceId)}/users`)
      .set(adminHeaders())
      .send({ userId: user.id, role: "operator" });

    expect(attach.status).toBe(201);

    // user queues open
    const open = await request(app)
      .post(`/devices/${encodeURIComponent(deviceId)}/open`)
      .set("authorization", "Bearer " + token)
      .send({ durationMs: 1000 });

    expect(open.status).toBe(201);
    const commandId = open.body.id;
    expect(commandId).toBeTruthy();

    // device polls sees command
    const poll1 = await request(app)
      .post("/device/poll")
      .send({ deviceId, lastResults: [] });

    expect(poll1.status).toBe(200);
    expect(poll1.body.commands.some((c) => c.commandId === commandId)).toBe(
      true,
    );

    // device completes command
    const poll2 = await request(app)
      .post("/device/poll")
      .send({ deviceId, lastResults: [{ commandId, result: "OK" }] });

    expect(poll2.status).toBe(200);
  });
});
