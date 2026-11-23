/* Tema efetivo, antes da primeira pintura: data-theme (escolha da pessoa) vence; sem ele, segue o aparelho.
   Grava em <html data-scheme="light|dark"> e acompanha mudanças do aparelho e da escolha. */
(function () {
  var html = document.documentElement, mq = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    var t = html.getAttribute("data-theme");
    html.setAttribute("data-scheme", t === "light" || t === "dark" ? t : mq.matches ? "dark" : "light");
  }
  apply();
  if (mq.addEventListener) mq.addEventListener("change", apply); else if (mq.addListener) mq.addListener(apply);
  new MutationObserver(apply).observe(html, { attributes: true, attributeFilter: ["data-theme"] });
})();
