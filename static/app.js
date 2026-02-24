const API_BASE = "/api";

const statusBadge = document.querySelector("#statusBadge");
const uploadForm = document.querySelector("#uploadForm");
const pdfFileInput = document.querySelector("#pdfFile");
const documentMeta = document.querySelector("#documentMeta");
const docIdDisplay = document.querySelector("#docIdDisplay");
const pageCountDisplay = document.querySelector("#pageCountDisplay");
const postUploadActions = document.querySelector("#postUploadActions");
const downloadPdfLink = document.querySelector("#downloadPdf");
const previewPanel = document.querySelector("#previewPanel");
const pageSelectInput = document.querySelector("#pageSelect");
const goToPageButton = document.querySelector("#goToPage");
const pagePreview = document.querySelector("#pagePreview");
const overlayLayer = document.querySelector("#overlayLayer");
const imageGallery = document.querySelector("#imageGallery");
const thumbnailStripContainer = document.querySelector("#thumbnailStripContainer");
const thumbnailStrip = document.querySelector("#thumbnailStrip");
const replacePanel = document.querySelector("#replacePanel");
const replaceForm = document.querySelector("#replaceForm");
const replacementImage = document.querySelector("#replacementImage");
const targetMeta = document.querySelector("#targetMeta");
const imageCardTemplate = document.querySelector("#imageCardTemplate");
const thumbnailTemplate = document.querySelector("#thumbnailTemplate");

let currentDocumentId = null;
let currentPageNumber = 1;
let pageCount = 0;
let pageDimensions = { width: 0, height: 0 };
let selectedImage = null;
const thumbnailCache = new Map();

function setStatus(message, variant = "default") {
  statusBadge.textContent = message;
  statusBadge.className = "hero__status";
  if (variant === "processing") statusBadge.classList.add("status--processing");
  if (variant === "error") statusBadge.classList.add("status--error");
  if (variant === "success") statusBadge.classList.add("status--success");
}

async function uploadPdf(event) {
  event.preventDefault();
  const file = pdfFileInput.files?.[0];
  if (!file) return;

  setStatus("Uploading PDF…", "processing");

  const formData = new FormData();
  formData.append("file", file);

  try {
    resetWorkspace();
    const response = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();
    currentDocumentId = data.document_id;
    pageCount = data.page_count;
    currentPageNumber = 1;

    documentMeta.hidden = false;
    docIdDisplay.textContent = currentDocumentId;
    pageCountDisplay.textContent = pageCount;
    pageSelectInput.max = pageCount;
    pageSelectInput.value = "1";
    previewPanel.hidden = false;
    postUploadActions.hidden = false;
    updateDownloadLink();

    await loadPage(currentPageNumber);
    await loadThumbnails();
    setStatus("PDF uploaded", "success");
  } catch (error) {
    console.error(error);
    setStatus("Upload failed", "error");
  }
}

async function loadPage(pageNumber) {
  if (!currentDocumentId) return;
  currentPageNumber = pageNumber;
  setStatus(`Rendering page ${pageNumber}…`, "processing");

  try {
    const previewRes = await fetch(
      buildApiUrl("preview", {
        document_id: currentDocumentId,
        page_number: pageNumber,
      }),
      { cache: "no-store" }
    );
    if (!previewRes.ok) throw new Error(await previewRes.text());
    const previewData = await previewRes.json();
    pagePreview.src = previewData.preview_data_url;
    pagePreview.dataset.width = previewData.width;
    pagePreview.dataset.height = previewData.height;
    pageDimensions = { width: previewData.width, height: previewData.height };
    pageSelectInput.value = String(pageNumber);
    thumbnailCache.set(pageNumber, previewData.preview_data_url);
    updateThumbnailImage(pageNumber, previewData.preview_data_url);

    const imagesRes = await fetch(
      buildApiUrl("images", {
        document_id: currentDocumentId,
        page_number: pageNumber,
      }),
      { cache: "no-store" }
    );
    if (!imagesRes.ok) throw new Error(await imagesRes.text());
    const imagesData = await imagesRes.json();

    renderOverlay(imagesData.images);
    renderGallery(imagesData.images);
    resetSelectionState();
    highlightThumbnail(pageNumber);
    setStatus(`Page ${pageNumber} ready`, "success");
  } catch (error) {
    console.error(error);
    setStatus("Failed to render page", "error");
  }
}

function renderOverlay(images) {
  overlayLayer.innerHTML = "";
  const { width, height } = pageDimensions;

  images.forEach((image) => {
    const [x1, y1, x2, y2] = image.bbox;
    const overlay = document.createElement("div");
    overlay.className = "overlay-box";
    overlay.dataset.index = String(image.index);
    overlay.style.left = `${(x1 / width) * 100}%`;
    overlay.style.top = `${(y1 / height) * 100}%`;
    overlay.style.width = `${((x2 - x1) / width) * 100}%`;
    overlay.style.height = `${((y2 - y1) / height) * 100}%`;

    overlay.addEventListener("click", () => selectImage(image));
    overlayLayer.appendChild(overlay);
  });
}

function renderGallery(images) {
  imageGallery.innerHTML = "";
  images.forEach((image) => {
    const card = imageCardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.index = image.index;
    card.addEventListener("click", () => selectImage(image));

    const thumb = card.querySelector(".image-card__thumb");
    thumb.style.backgroundImage = `url(${image.preview_data_url})`;

    const meta = card.querySelector(".image-card__meta");
    meta.innerHTML = `
      <div><strong>Index:</strong> ${image.index}</div>
      <div><strong>Resolution:</strong> ${image.width} × ${image.height}</div>
      <div><strong>Bounds:</strong> ${image.bbox.map((v) => v.toFixed(1)).join(", ")}</div>
    `;

    imageGallery.appendChild(card);
  });
}

function resetSelectionState() {
  replacePanel.hidden = true;
  selectedImage = null;
  replacementImage.value = "";
  imageGallery
    .querySelectorAll(".image-card")
    .forEach((card) => card.classList.remove("image-card--active"));
  overlayLayer
    .querySelectorAll(".overlay-box")
    .forEach((overlay) => overlay.classList.remove("overlay-box--active"));
}

function selectImage(image) {
  selectedImage = image;
  highlightSelected(image);
  replacePanel.hidden = false;
  targetMeta.innerHTML = `
    <div><strong>Selected Image Index:</strong> ${image.index}</div>
    <div><strong>Resolution:</strong> ${image.width} × ${image.height}</div>
    <div><strong>Bounding Box:</strong> ${image.bbox.map((v) => v.toFixed(1)).join(", ")}</div>
  `;
}

function highlightSelected(image) {
  imageGallery
    .querySelectorAll(".image-card")
    .forEach((card) => {
      card.classList.toggle(
        "image-card--active",
        Number(card.dataset.index) === image.index
      );
    });

  overlayLayer
    .querySelectorAll(".overlay-box")
    .forEach((overlay) => {
      overlay.classList.toggle(
        "overlay-box--active",
        Number(overlay.dataset.index) === image.index
      );
    });
}

async function replaceImage(event) {
  event.preventDefault();
  if (!selectedImage || !currentDocumentId) return;

  const file = replacementImage.files?.[0];
  if (!file) return;

  setStatus("Replacing image…", "processing");

  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams({
    document_id: currentDocumentId,
    page_number: currentPageNumber,
    image_index: String(selectedImage.index),
  });

  try {
    const response = await fetch(`${API_BASE}/replace?${params.toString()}`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error(await response.text());

    await loadPage(currentPageNumber);
    replacementImage.value = "";
    updateDownloadLink();
    setStatus("Image replaced successfully", "success");
  } catch (error) {
    console.error(error);
    setStatus("Replacement failed", "error");
  }
}

uploadForm?.addEventListener("submit", uploadPdf);
goToPageButton?.addEventListener("click", () => {
  const pageValue = Number(pageSelectInput.value);
  if (!Number.isNaN(pageValue) && pageValue >= 1 && pageValue <= pageCount) {
    currentPageNumber = pageValue;
    loadPage(currentPageNumber);
  }
});

pageSelectInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    goToPageButton.click();
  }
});

replaceForm?.addEventListener("submit", replaceImage);

function updateDownloadLink() {
  if (!currentDocumentId) return;
  const url = `${API_BASE}/document/${currentDocumentId}`;
  downloadPdfLink.href = url;
  downloadPdfLink.setAttribute("download", `pdf-image-surgeon-${currentDocumentId}.pdf`);
}

function highlightThumbnail(pageNumber) {
  if (!thumbnailStrip) return;
  thumbnailStrip
    .querySelectorAll(".thumbnail-card")
    .forEach((card) => {
      card.classList.toggle(
        "thumbnail-card--active",
        Number(card.dataset.page) === pageNumber
      );
    });
}

function updateThumbnailImage(pageNumber, dataUrl) {
  const card = thumbnailStrip?.querySelector(`.thumbnail-card[data-page="${pageNumber}"]`);
  if (card) {
    const imgEl = card.querySelector(".thumbnail-card__image");
    if (imgEl) {
      imgEl.src = dataUrl;
    }
  }
}

function resetWorkspace() {
  thumbnailCache.clear();
  thumbnailStrip.innerHTML = "";
  thumbnailStripContainer.hidden = true;
  overlayLayer.innerHTML = "";
  imageGallery.innerHTML = "";
  replacePanel.hidden = true;
}

async function loadThumbnails() {
  if (!currentDocumentId) return;
  thumbnailStrip.innerHTML = "";
  thumbnailCache.forEach((dataUrl, page) => {
    appendThumbnail(page, dataUrl);
  });

  for (let page = 1; page <= pageCount; page += 1) {
    if (!thumbnailCache.has(page)) {
      try {
        const previewRes = await fetch(
          buildApiUrl("preview", {
            document_id: currentDocumentId,
            page_number: page,
            zoom: 0.6,
          }),
          { cache: "no-store" }
        );
        if (!previewRes.ok) throw new Error(await previewRes.text());
        const previewData = await previewRes.json();
        thumbnailCache.set(page, previewData.preview_data_url);
        appendThumbnail(page, previewData.preview_data_url);
      } catch (error) {
        console.error("Failed to load thumbnail", page, error);
      }
    }
  }

  if (pageCount > 1) {
    thumbnailStripContainer.hidden = false;
    highlightThumbnail(currentPageNumber);
  } else {
    thumbnailStripContainer.hidden = true;
  }
}

function appendThumbnail(pageNumber, dataUrl) {
  const existing = thumbnailStrip.querySelector(
    `.thumbnail-card[data-page="${pageNumber}"]`
  );
  if (existing) {
    const imgEl = existing.querySelector(".thumbnail-card__image");
    if (imgEl) imgEl.src = dataUrl;
    return;
  }

  const card = thumbnailTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.page = String(pageNumber);
  const imgEl = card.querySelector(".thumbnail-card__image");
  const pageLabel = card.querySelector(".thumbnail-card__page");
  if (imgEl) {
    imgEl.src = dataUrl;
  }
  if (pageLabel) {
    pageLabel.textContent = `Page ${pageNumber}`;
  }

  card.addEventListener("click", () => {
    if (!currentDocumentId || currentPageNumber === pageNumber) return;
    const nextPage = pageNumber;
    pageSelectInput.value = String(nextPage);
    loadPage(nextPage).catch((error) => console.error(error));
  });

  thumbnailStrip.appendChild(card);
}

function buildApiUrl(path, params) {
  const url = new URL(`${API_BASE}/${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  url.searchParams.set("_", Date.now().toString());
  return url.toString();
}
