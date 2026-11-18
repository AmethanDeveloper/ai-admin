// Значок «Powered by Netlify» (бесплатный план) висит в правом нижнем углу поверх страницы
// и закрывает кнопки. Пока он на странице, ставим класс nl-badge на <html>, и стили освобождают ему место.
// Когда значок выключат в настройках Netlify (платный план) или посетитель его скроет — всё вернётся как было.
(function () {
  var root = document.documentElement;
  function check() {
    var f = document.getElementById("nl-badge-frame");
    var on = !!f && f.offsetWidth > 0 && getComputedStyle(f).display !== "none" && getComputedStyle(f).visibility !== "hidden";
    root.classList.toggle("nl-badge", on);
  }
  function watch() {
    check();
    new MutationObserver(check).observe(document.body, { childList: true });
    setTimeout(check, 1500);
    setTimeout(check, 5000);
  }
  if (document.body) watch(); else document.addEventListener("DOMContentLoaded", watch);
  addEventListener("load", check);
  addEventListener("resize", check);
})();
