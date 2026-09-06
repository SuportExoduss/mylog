// Botao de imprimir dos relatorios.
//
// Era `onclick="print()"` no proprio HTML. A CSP com `script-src 'self'` recusa
// manipulador embutido, e a recusa e' silenciosa: o botao continua na tela, com
// o atributo no lugar, e simplesmente nao faz nada. Foi assim que ele passou
// despercebido — nenhum teste de cabecalho ve um clique que nao acontece.
addEventListener('click', (evento) => {
  if (evento.target.closest('[data-imprimir]')) print()
})
