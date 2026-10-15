import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCleanIncludedModel, buildPoolLabelMap } from "./provider.ts";

describe("Dynamic Provider Filtering & Granular Coexistence", () => {
    const mockFilterData = {
        validPrefixes: new Set(["agy", "agy2"]),
        prefixExclusions: new Map([["agy", new Set<string>()], ["agy2", new Set<string>()]]),
        familyActiveLeaderPrefix: new Map([["gemini_pure", "agy"]]),
        prefixToFamily: new Map([["agy", "gemini_pure"], ["agy2", "gemini_pure"]]),
        activePoolFamilies: new Set(["gemini_pure"]),
        poolAssignedPrefixes: new Set(["agy", "agy2"]),
        activeBareProviders: new Set(["antigravity"]),
        bareExclusions: new Set<string>(),
        registeredPoolBases: new Set(["agy", "agy2"]),
    };

    it("includes canonical pool clean facades (Pool-01-gemini, Pool-02-gemini)", () => {
        assert.equal(isCleanIncludedModel("Pool-01-gemini", mockFilterData), true);
        assert.equal(isCleanIncludedModel("Pool-02-gemini", mockFilterData), true);
    });

    it("masks physical accounts assigned to active pools", () => {
        assert.equal(isCleanIncludedModel("agy/gemini-3.8-flash-high", mockFilterData), false);
        assert.equal(isCleanIncludedModel("agy2/gemini-3.8-flash-high", mockFilterData), false);
    });

    it("masks reserve accounts (_1, _2...) on disk", () => {
        assert.equal(isCleanIncludedModel("agy_1/gemini-3.8-flash-high", mockFilterData), false);
        assert.equal(isCleanIncludedModel("agy2_1/gemini-3.8-flash-high", mockFilterData), false);
    });

    it("includes bare native models when an active unassigned bare provider exists", () => {
        assert.equal(isCleanIncludedModel("gemini-3.8-flash-high", mockFilterData), true);
        assert.equal(isCleanIncludedModel("gemini-3.7-flash-high", mockFilterData), true);
    });

    it("blocks third-party phantom models from omni-auth-pro", () => {
        assert.equal(isCleanIncludedModel("gpt-6-luna", mockFilterData), false);
        assert.equal(isCleanIncludedModel("deepseek-flash", mockFilterData), false);
        assert.equal(isCleanIncludedModel("deepseek-v4-flash", mockFilterData), false);
        assert.equal(isCleanIncludedModel("qwen3.8-flash", mockFilterData), false);
        assert.equal(isCleanIncludedModel("minimax-m3", mockFilterData), false);
    });

    it("blocks bare models when no active unassigned bare provider exists", () => {
        const noBareFilterData = {
            ...mockFilterData,
            activeBareProviders: new Set<string>(),
        };
        assert.equal(isCleanIncludedModel("gemini-3.8-flash-high", noBareFilterData), false);
    });

    it("respects exclusions defined in free accounts on disk", () => {
        const excludedFilterData = {
            ...mockFilterData,
            bareExclusions: new Set(["gemini-3-flash"]),
        };
        assert.equal(isCleanIncludedModel("gemini-3.8-flash-high", excludedFilterData), true);
        assert.equal(isCleanIncludedModel("gemini-3-flash", excludedFilterData), false);
    });

    it("labels registered pool prefixes with P1, P2 and unassigned with LIBRE", () => {
        const labels = buildPoolLabelMap(["agy", "agy_1", "agy3"], new Set(["agy"]));
        assert.equal(labels.get("agy"), "P1·LÍDER agy");
        assert.equal(labels.get("agy_1"), "P1·RESERVA agy_1");
        assert.equal(labels.get("agy3"), "LIBRE agy3");
    });
});
