import { test, expect, type BrowserContext } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const origin = "http://localhost:43991";
async function login(context: BrowserContext, role: string) {
  const cookies = JSON.parse(
    await readFile(".cache/e2e-sessions.json", "utf8"),
  );
  const [name, ...value] = cookies[role].split("=");
  await context.addCookies([{ name, value: value.join("="), url: origin }]);
}
test("real friendship journey persists requests/acceptance/removal/refusal and never shares private memories or social lists", async ({
  page,
  context,
  browser,
}, info) => {
  const suffix = info.project.name.replaceAll("-", "_"),
    a = "friend_a_" + suffix,
    b = "friend_b_" + suffix;
  await login(context, "friend-a-" + info.project.name);
  const peer = await browser.newContext();
  await login(peer, "friend-b-" + info.project.name);
  const peerPage = await peer.newPage();
  try {
    await page.goto("/profil");
    await page.getByRole("link", { name: "Mes amis", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Les amis du club." }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toBeEmpty();
    await page.getByLabel("Chercher un pseudo").fill(b);
    await page.getByRole("button", { name: "Chercher", exact: true }).click();
    const results = page.locator(".friend-section").filter({
      has: page.getByRole("heading", { name: "Résultats", exact: true }),
    });
    await results.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Demande envoyée.");
    await page.reload();
    const sent = page.locator(".friend-section").filter({
      has: page.getByRole("heading", {
        name: "Demandes envoyées",
        exact: true,
      }),
    });
    await expect(sent.getByText(b, { exact: true })).toBeVisible();
    await sent.getByRole("button", { name: "Annuler" }).click();
    await expect(page.getByRole("status")).toHaveText("Demande annulée.");
    await page.getByLabel("Chercher un pseudo").fill(b);
    await page.getByRole("button", { name: "Chercher", exact: true }).click();
    await results.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Demande envoyée.");
    // Repeated POST and crossed request are one persisted request.
    const repeat = await context.request.post(
      "/api/v1/me/friends/requests/" + b,
      { headers: { origin } },
    );
    expect(repeat.status()).toBe(200);
    const id = (await repeat.json()).id;
    const crossed = await peer.request.post(
      "/api/v1/me/friends/requests/" + a,
      { headers: { origin } },
    );
    expect((await crossed.json()).id).toBe(id);
    await peerPage.goto("/amis");
    const received = peerPage.locator(".friend-section").filter({
      has: peerPage.getByRole("heading", {
        name: "Demandes reçues",
        exact: true,
      }),
    });
    await expect(received.getByText(a, { exact: true })).toBeVisible();
    await mkdir(".cache/friends-visual", { recursive: true });
    await peerPage.screenshot({
      path: ".cache/friends-visual/" + info.project.name + "-received.png",
      fullPage: true,
    });
    await received.getByRole("button", { name: "Accepter" }).click();
    await expect(peerPage.getByRole("status")).toHaveText(
      "Vous êtes maintenant amis.",
    );
    await page.reload();
    const friends = page.locator(".friend-section").filter({
      has: page.getByRole("heading", { name: "Mes amis", exact: true }),
    });
    await expect(
      friends.getByRole("link", { name: b, exact: true }),
    ).toBeVisible();
    const bytes = await readFile(".cache/e2e-photo.png");
    const memories = [];
    for (const visibility of ["public", "private"]) {
      const uploaded = await peer.request.post("/api/v1/media", {
        headers: { origin, "content-type": "application/octet-stream" },
        data: bytes,
      });
      expect(uploaded.status()).toBe(201);
      const media = (await uploaded.json()).media;
      const entry = await peer.request.post("/api/v1/encounters", {
        headers: { origin, "idempotency-key": crypto.randomUUID() },
        data: {
          mediaId: media.id,
          title: "Ami " + visibility + " " + info.project.name,
          encounterDate: "2026-10-07",
          visibility,
        },
      });
      expect(entry.status()).toBe(201);
      memories.push((await entry.json()).encounter);
    }
    expect(
      (
        await context.request.get("/api/v1/encounters/" + memories[1].id)
      ).status(),
    ).toBe(404);
    expect((await context.request.get(memories[1].image)).status()).toBe(404);
    await friends.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".cache/friends-visual/" + info.project.name + "-friends.png",
      fullPage: true,
    });
    if (info.project.name === "chromium-mobile") {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({
        path: ".cache/friends-visual/desktop-friends.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 393, height: 851 });
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await friends.getByRole("link", { name: b, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: b, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: memories[0].title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: memories[0].title, exact: true }),
    ).toHaveAttribute("href", "/rencontre/" + memories[0].id);
    await expect(
      page.getByText(memories[1].title, { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Mes amis", exact: true }),
    ).toHaveCount(0);
    await page.goto("/amis");
    await friends.getByRole("button", { name: "Retirer", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Ami retiré.");
    const again = await peer.request.post("/api/v1/me/friends/requests/" + a, {
      headers: { origin },
    });
    expect(again.status()).toBe(200);
    await page.reload();
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Demande refusée.");
    expect(
      (
        await peer.request.post("/api/v1/me/friends/requests/" + a, {
          headers: { origin },
        })
      ).status(),
    ).toBe(200);
    await peerPage.reload();
    await peerPage
      .getByRole("button", { name: "Annuler", exact: true })
      .click();
    await expect(peerPage.getByRole("status")).toHaveText("Demande annulée.");
    // Reach the real durable quota; cancellations do not refund reservations.
    let limited = false;
    for (let n = 0; n < 11; n++) {
      const r = await context.request.post("/api/v1/me/friends/requests/" + b, {
        headers: { origin },
      });
      if (r.status() === 429) {
        limited = true;
        break;
      }
      expect(r.status()).toBe(200);
      const request = await r.json();
      expect(
        (
          await context.request.post(
            "/api/v1/me/friends/" + request.id + "/cancel",
            { headers: { origin } },
          )
        ).status(),
      ).toBe(200);
    }
    expect(limited).toBe(true);
    await page.getByLabel("Chercher un pseudo").fill(b);
    await page.getByRole("button", { name: "Chercher", exact: true }).click();
    await results.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "La limite de demandes d’amis est atteinte.",
    );
    await expect(page.getByRole("status")).toContainText("secondes");
    for (const memory of memories)
      expect(
        (
          await peer.request.delete("/api/v1/encounters/" + memory.id, {
            headers: { origin },
          })
        ).status(),
      ).toBe(200);
  } finally {
    await peer.close();
  }
});
test("friend states render in Storybook with private-list copy and no mobile overflow", async ({
  page,
}) => {
  for (const story of [
    "empty",
    "requests",
    "with-friends",
    "limited",
    "unavailable-peer",
  ]) {
    await page.goto(
      "http://localhost:43992/iframe.html?id=comptes-friendspanel--" +
        story +
        "&viewMode=story",
    );
    await expect(
      page.getByRole("heading", { name: "Les amis du club." }),
    ).toBeVisible();
    await expect(
      page.getByText("Ta liste reste personnelle.", { exact: false }),
    ).toBeVisible();
    if (story === "requests")
      await expect(
        page.getByRole("button", { name: "Accepter", exact: true }),
      ).toBeVisible();
    if (story === "unavailable-peer") {
      await expect(
        page.getByRole("button", { name: "Accepter", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText("Membre indisponible", { exact: true }),
      ).toBeVisible();
      await expect(page.locator('a[href^="/profil/"]')).toHaveCount(0);
    }
    if (story === "limited")
      await expect(page.getByRole("status")).toContainText("3600 secondes");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
