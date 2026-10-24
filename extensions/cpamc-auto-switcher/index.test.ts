import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveHubBaseUrl } from "./index.js";

describe("Extension Pi - resolveHubBaseUrl Security Contract", () => {
	const originalAutoHub = process.env.AUTO_SWITCHER_HUB_URL;
	const originalCpamcHub = process.env.CPAMC_LICENSE_HUB_URL;

	beforeEach(() => {
		delete process.env.AUTO_SWITCHER_HUB_URL;
		delete process.env.CPAMC_LICENSE_HUB_URL;
	});

	afterEach(() => {
		if (originalAutoHub !== undefined) process.env.AUTO_SWITCHER_HUB_URL = originalAutoHub;
		else delete process.env.AUTO_SWITCHER_HUB_URL;

		if (originalCpamcHub !== undefined) process.env.CPAMC_LICENSE_HUB_URL = originalCpamcHub;
		else delete process.env.CPAMC_LICENSE_HUB_URL;
	});

	it("defaults strictly to TLS domain https://hub.wiloxdev.com", () => {
		const url = resolveHubBaseUrl();
		expect(url).toBe("https://hub.wiloxdev.com");
	});

	it("prioritizes AUTO_SWITCHER_HUB_URL and strips trailing slashes", () => {
		process.env.AUTO_SWITCHER_HUB_URL = "https://custom-hub.example.com///";
		const url = resolveHubBaseUrl();
		expect(url).toBe("https://custom-hub.example.com");
	});

	it("falls back to CPAMC_LICENSE_HUB_URL when AUTO_SWITCHER_HUB_URL is unset", () => {
		process.env.CPAMC_LICENSE_HUB_URL = "https://secondary-hub.example.com/";
		const url = resolveHubBaseUrl();
		expect(url).toBe("https://secondary-hub.example.com");
	});
});
