(function installOfflineRetry() {
  "use strict";

  var retryButton = document.getElementById("offline-retry");
  if (!retryButton) return;
  retryButton.addEventListener("click", function retryNavigation() {
    window.location.reload();
  });
})();
