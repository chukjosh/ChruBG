// Compare models: run one image through two models and keep the result you prefer.

const compareDialog = document.getElementById("compare-dialog");
const compareLeftSelect = document.getElementById("compare-left");
const compareRightSelect = document.getElementById("compare-right");
const compareRunButton = document.getElementById("compare-run");
const compareStatus = document.getElementById("compare-status");
const compareSides = {
  left: {
    image: document.getElementById("compare-left-image"),
    caption: document.getElementById("compare-left-caption"),
    useButton: document.getElementById("compare-left-use"),
    select: compareLeftSelect,
  },
  right: {
    image: document.getElementById("compare-right-image"),
    caption: document.getElementById("compare-right-caption"),
    useButton: document.getElementById("compare-right-use"),
    select: compareRightSelect,
  },
};

let compareState = null;

/** The models this image could also be run through. They must match where it was processed. */
function modelsForItem(item) {
  return item.location === "browser" ? browserModels : serverModels;
}

function clearCompareResults() {
  if (!compareState) return;
  Object.values(compareState.results).forEach((result) => result && URL.revokeObjectURL(result.url));
  compareState.results = { left: null, right: null };
  Object.values(compareSides).forEach((side) => {
    side.image.removeAttribute("src");
    side.image.hidden = true;
    side.caption.textContent = "";
    side.useButton.hidden = true;
  });
}

function openCompareModels(item) {
  const models = modelsForItem(item);
  if (models.length < 2) return;

  const labelFor = (model) => (model.badge ? `${model.label} (${model.badge})` : model.label);
  [compareLeftSelect, compareRightSelect].forEach((select) => select.replaceChildren(...models.map((model) => new Option(labelFor(model), model.id))));
  const currentIndex = Math.max(0, models.findIndex((model) => model.id === item.modelId));
  compareLeftSelect.value = models[currentIndex].id;
  compareRightSelect.value = models[(currentIndex + 1) % models.length].id;

  compareState = { item, models, results: { left: null, right: null } };
  clearCompareResults();
  compareStatus.textContent = "";
  compareRunButton.disabled = false;
  compareDialog.showModal();
}

async function runComparison() {
  const { item, models } = compareState;
  if (compareLeftSelect.value === compareRightSelect.value) {
    compareStatus.textContent = "Pick two different models to compare.";
    return;
  }
  clearCompareResults();
  compareRunButton.disabled = true;

  try {
    for (const [sideName, side] of Object.entries(compareSides)) {
      const model = models.find((candidate) => candidate.id === side.select.value);
      compareStatus.textContent = `Running ${model.label}...`;
      const startedAt = performance.now();
      const blob = item.location === "browser" ? await runModelInBrowser(item, model) : await requestCutout(item, model.id);
      const seconds = (performance.now() - startedAt) / 1000;

      const url = URL.createObjectURL(blob);
      compareState.results[sideName] = { blob, url, model };
      side.image.src = url;
      side.image.hidden = false;
      side.caption.textContent = `${model.label}, ${seconds.toFixed(1)} s`;
      side.useButton.hidden = false;
    }
    compareStatus.textContent = "Done. Use the result you prefer, or close this to keep your current one.";
  } catch (error) {
    compareStatus.textContent = error.message || "The comparison could not be completed.";
  } finally {
    compareRunButton.disabled = false;
  }
}

/** Replaces the image's cutout with the chosen result. */
function useComparisonResult(sideName) {
  const { item, results } = compareState;
  const chosen = results[sideName];
  if (!chosen || item.wasRemoved) return;

  if (item.cutoutUrl) URL.revokeObjectURL(item.cutoutUrl);
  item.cutoutBlob = chosen.blob;
  item.cutoutUrl = URL.createObjectURL(chosen.blob);
  item.model = chosen.model;
  item.modelId = chosen.model.id;
  item.modelLabel = `${chosen.model.label}${item.location === "browser" ? ", in your browser" : ""}`;
  updateCard(item);
  refreshEdgePreviews();
  compareDialog.close();
}

compareRunButton.addEventListener("click", runComparison);
document.getElementById("compare-close").addEventListener("click", () => compareDialog.close());
compareSides.left.useButton.addEventListener("click", () => useComparisonResult("left"));
compareSides.right.useButton.addEventListener("click", () => useComparisonResult("right"));
compareDialog.addEventListener("close", () => {
  clearCompareResults();
  compareState = null;
});
