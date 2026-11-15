// One time, skippable walkthrough. It opens on a first visit and can be reopened with "Take the tour".

const TOUR_SEEN_STORAGE_KEY = "chrubg-tour-seen";
const TOUR_STEPS = [
  {
    title: "Add your images",
    text: "Drop images anywhere on the page, paste them, or click to choose files. Add as many as you like, and add more at any time.",
    targetSelector: "#dropzone",
  },
  {
    title: "Choose how to process",
    text: "If more than one model is available, pick one here. You may also see a switch to process images on your own device instead of the server. The server is used unless you choose otherwise.",
    targetSelector: "#model-picker",
  },
  {
    title: "Compare the result",
    text: "When an image is done, drag the pink line across it to compare before and after.",
  },
  {
    title: "Fix and reshape, if you want to",
    text: "Touch up erases leftovers or restores parts removed by mistake. Crop and resize sets an exact size, such as a passport photo. Neither is applied unless you use it.",
  },
  {
    title: "Download",
    text: "Pick a background colour, format and size, then download one image or everything as a ZIP.",
  },
  {
    title: "Your images stay in this tab",
    text: "Results are kept only until you remove them or close the tab. You can reopen this tour at any time with Take the tour.",
  },
];

const tourElement = document.getElementById("tour");
const tourButton = document.getElementById("tour-button");
const tourNextButton = document.getElementById("tour-next");
const tourBackButton = document.getElementById("tour-back");
let currentTourStep = null;

function hasSeenTour() {
  try {
    return localStorage.getItem(TOUR_SEEN_STORAGE_KEY) === "yes";
  } catch (ignoredStorageError) {
    return false;
  }
}

function rememberTourSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_STORAGE_KEY, "yes");
  } catch (ignoredStorageError) {}
}

/** Steps that point at something hidden right now, such as a model picker with one choice, are skipped. */
function getAvailableTourSteps() {
  return TOUR_STEPS.filter((step) => {
    if (!step.targetSelector) return true;
    const target = document.querySelector(step.targetSelector);
    return Boolean(target) && !target.closest("[hidden]");
  });
}

function clearTourHighlight() {
  document.querySelectorAll(".tour-highlight").forEach((element) => element.classList.remove("tour-highlight"));
}

function showTourStep(step) {
  currentTourStep = step;
  const availableSteps = getAvailableTourSteps();
  const stepNumber = availableSteps.indexOf(step) + 1;

  document.getElementById("tour-progress").textContent = `Step ${stepNumber} of ${availableSteps.length}`;
  document.getElementById("tour-title").textContent = step.title;
  document.getElementById("tour-text").textContent = step.text;
  tourBackButton.disabled = stepNumber === 1;
  tourNextButton.textContent = stepNumber === availableSteps.length ? "Done" : "Next";

  clearTourHighlight();
  if (step.targetSelector) {
    const target = document.querySelector(step.targetSelector);
    target.classList.add("tour-highlight");
    target.scrollIntoView({ block: "center" });
  }
}

function startTour() {
  tourElement.hidden = false;
  showTourStep(getAvailableTourSteps()[0]);
  tourNextButton.focus();
}

function closeTour() {
  tourElement.hidden = true;
  clearTourHighlight();
  currentTourStep = null;
  rememberTourSeen(); // skipping counts as seen, so it will not open by itself again
}

function moveTour(direction) {
  const availableSteps = getAvailableTourSteps();
  const nextIndex = availableSteps.indexOf(currentTourStep) + direction;
  if (nextIndex >= availableSteps.length) closeTour();
  else if (nextIndex >= 0) showTourStep(availableSteps[nextIndex]);
}

tourNextButton.addEventListener("click", () => moveTour(1));
tourBackButton.addEventListener("click", () => moveTour(-1));
document.getElementById("tour-skip").addEventListener("click", closeTour);
tourButton.addEventListener("click", startTour);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !tourElement.hidden) closeTour();
});

// Open by itself only on a first visit, after the model list has had a moment to load
if (!hasSeenTour()) setTimeout(startTour, 600);
