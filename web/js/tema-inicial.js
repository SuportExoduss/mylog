// Aplica o tema guardado antes da primeira pintura, para nao piscar branco em
// quem escolheu o escuro.
//
// Mora num arquivo proprio, e nao embutido no HTML, por causa da CSP: com
// `script-src 'self'` nenhum script inline roda. A alternativa seria declarar o
// hash do trecho na politica, e ai qualquer edicao aqui apagaria o tema em
// silencio — o navegador recusa o script e nada acusa. Um arquivo a mais, em
// cache, custa menos que esse tipo de armadilha.
//
// Precisa ser sincrono e vir antes do <body>: com `defer` ou `async` ele
// rodaria depois da primeira pintura, que e' exatamente o que se quer evitar.
try {
  const tema = localStorage.getItem('mylog.tema')
  if (tema) document.documentElement.dataset.tema = tema
} catch {
  // Sem storage (aba anonima, cookies bloqueados): segue a preferencia do
  // sistema, que a media query do CSS ja resolve sozinha.
}
