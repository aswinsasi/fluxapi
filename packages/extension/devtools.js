// Register the FluxAPI panel in Chrome DevTools
chrome.devtools.panels.create(
  'FluxAPI',
  'icons/icon-16.png',
  'panel.html',
  (panel) => {
    // Panel created
    console.log('[FluxAPI] DevTools panel registered');
  }
);
