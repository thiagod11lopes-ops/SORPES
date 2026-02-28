/**
 * SORPES - Controle Financeiro Familiar
 * Script principal - Persistência em IndexedDB
 */

(function () {
    'use strict';

    const DB_NAME = 'sorpes-db';
    const DB_VERSION = 1;
    const STORE_NAME = 'dados';
    const STATE_KEY = 'estado';

    function openDB() {
        return new Promise(function (resolve, reject) {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = function () { reject(req.error); };
            req.onsuccess = function () { resolve(req.result); };
            req.onupgradeneeded = function (e) {
                if (!e.target.result.objectStoreNames.contains(STORE_NAME)) {
                    e.target.result.createObjectStore(STORE_NAME);
                }
            };
        });
    }

    function saveToDB(state) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.put(state, STATE_KEY);
                tx.oncomplete = function () {
                    db.close();
                    if (window.sorpesFirebase && typeof window.sorpesFirebase.salvarEstado === 'function') {
                        window.sorpesFirebase.salvarEstado(state);
                    }
                    resolve();
                };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function () {});
    }

    function loadFromDB() {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(STATE_KEY);
                req.onsuccess = function () { db.close(); resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        }).catch(function () { return null; });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var state = { meses: {}, mesAtivo: '2026-02', anoAtivo: '2026', usuarios: [] };

        function getEmptyMonthData() {
            return { gastosFixos: [], gastosVariaveis: [], gastosMensais: [], receitas: [], ganhosFuturos: [] };
        }

        function getPreviousMonthKey(chave) {
            var partes = chave.split('-');
            if (partes.length !== 2) return null;
            var ano = parseInt(partes[0], 10);
            var mes = parseInt(partes[1], 10);
            if (mes === 1) {
                ano -= 1;
                mes = 12;
            } else {
                mes -= 1;
            }
            return ano + '-' + String(mes).padStart(2, '0');
        }

        function copyMonthDataFrom(previousKey) {
            var ant = state.meses[previousKey];
            if (!ant) return getEmptyMonthData();
            var fixos = (ant.gastosFixos || []).map(function (g) {
                return { vencimento: g.vencimento, descricao: g.descricao, tipo: g.tipo, valor: g.valor, pago: false, usuario: g.usuario };
            });
            var variaveis = (ant.gastosVariaveis || []).map(function (g) {
                return { vencimento: g.vencimento, descricao: g.descricao, tipo: g.tipo, valor: g.valor, pago: false, usuario: g.usuario };
            });
            var baseId = Date.now();
            var mensais = (ant.gastosMensais || []).map(function (c, idx) {
                return { id: 'gasto-mensal-' + baseId + '-' + idx, titulo: c.titulo || '', limite: c.limite || 0, items: [] };
            });
            return {
                gastosFixos: fixos,
                gastosVariaveis: variaveis,
                gastosMensais: mensais,
                receitas: [],
                ganhosFuturos: []
            };
        }

        function hasMonthData(chave) {
            var d = state.meses[chave];
            if (!d) return false;
            if (d.gastosFixos && d.gastosFixos.length > 0) return true;
            if (d.gastosVariaveis && d.gastosVariaveis.length > 0) return true;
            if (d.receitas && d.receitas.length > 0) return true;
            if (d.ganhosFuturos && d.ganhosFuturos.length > 0) return true;
            if (d.gastosMensais && d.gastosMensais.length > 0) {
                for (var i = 0; i < d.gastosMensais.length; i++) {
                    if (d.gastosMensais[i].items && d.gastosMensais[i].items.length > 0) return true;
                    if (d.gastosMensais[i].limite && d.gastosMensais[i].limite > 0) return true;
                }
            }
            return false;
        }

        function getAnos() {
            var anos = {};
            Object.keys(state.meses).forEach(function (chave) {
                var ano = chave.split('-')[0];
                if (ano) anos[ano] = true;
            });
            return Object.keys(anos).sort().reverse();
        }
        function getMesesDoAno(ano) {
            if (!ano) return [];
            return Object.keys(state.meses).filter(function (chave) {
                return chave.indexOf(ano + '-') === 0;
            }).sort().reverse();
        }

        var nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        function formatarNomeMes(chave) {
            var partes = chave.split('-');
            if (partes.length !== 2) return chave;
            var mesIdx = parseInt(partes[1], 10) - 1;
            return (nomesMeses[mesIdx] || partes[1]) + ' ' + partes[0];
        }

        // Navegação por abas (Gastos Fixos, Variáveis, etc.)
        const tabBotoes = document.querySelectorAll('.tab-botao');
        const tabPaineis = document.querySelectorAll('.tab-painel');

        tabBotoes.forEach(function (botao) {
            botao.addEventListener('click', function () {
                const tabAlvo = botao.dataset.tab;

                tabBotoes.forEach(function (b) { b.classList.remove('ativo'); });
                tabPaineis.forEach(function (p) { p.classList.remove('ativo'); });

                botao.classList.add('ativo');
                document.getElementById('painel-' + tabAlvo).classList.add('ativo');
                if (tabAlvo === 'mensais' && typeof atualizarSelectMovimentacoes === 'function') {
                    atualizarSelectMovimentacoes();
                }
            });
        });

        const formularios = document.querySelectorAll('.formulario-gasto');

        let linhaEmEdicao = null;
        let formEmEdicao = null;
        let linhaEmEdicaoReceita = null;

        function ocultarFormGasto(form) {
            form.classList.remove('visivel');
        }
        function mostrarFormGasto(form) {
            form.classList.add('visivel');
        }

        document.getElementById('btn-plus-fixos').addEventListener('click', function () {
            var form = document.getElementById('form-gastos-fixos');
            if (form) {
                form.classList.toggle('visivel');
            }
        });
        document.getElementById('btn-plus-variaveis').addEventListener('click', function () {
            var form = document.getElementById('form-gastos-variaveis');
            if (form) {
                form.classList.toggle('visivel');
            }
        });
        document.getElementById('btn-plus-receitas').addEventListener('click', function () {
            var form = document.getElementById('form-receitas');
            if (form) {
                form.classList.toggle('visivel');
            }
        });
        document.getElementById('btn-plus-ganhos-futuros').addEventListener('click', function () {
            var form = document.getElementById('form-ganhos-futuros');
            if (form) {
                form.classList.toggle('visivel');
            }
        });

        formularios.forEach(function (form) {
            const btnAdicionar = form.querySelector('.btn-adicionar');
            const btnCancelarEdicao = form.querySelector('.btn-cancelar-edicao');
            if (!form.dataset.tipo || (form.dataset.tipo !== 'fixo' && form.dataset.tipo !== 'variavel')) return;

            form.addEventListener('submit', function (e) {
                e.preventDefault();

                const vencimento = form.querySelector('[name="vencimento"]').value;
                const descricao = form.querySelector('[name="descricao"]').value;
                const tipo = form.querySelector('[name="tipo"]').value;
                const valor = parseFloat(form.querySelector('[name="valor"]').value);
                const pago = linhaEmEdicao ? linhaEmEdicao.dataset.pago === 'true' : false;
                const usuarioSel = form.querySelector('[name="usuario"]');
                const usuario = usuarioSel ? usuarioSel.value : '';

                const tabelaId = form.dataset.tipo === 'fixo' ? 'tabela-gastos-fixos' : 'tabela-gastos-variaveis';
                const tbody = document.querySelector('#' + tabelaId + ' tbody');

                if (linhaEmEdicao) {
                    atualizarLinha(linhaEmEdicao, vencimento, descricao, tipo, valor, pago, usuario);
                    sairModoEdicao(form, btnAdicionar, btnCancelarEdicao);
                    linhaEmEdicao = null;
                    formEmEdicao = null;
                    atualizarTotais();
                } else {
                    const tr = criarLinhaTabela(vencimento, descricao, tipo, valor, false, usuario);
                    tbody.appendChild(tr);
                    vincularEventosLinha(tr, form, tabelaId, btnAdicionar, btnCancelarEdicao);
                }
                ordenarTabelaPorVencimento(tbody);
                form.reset();
                ocultarFormGasto(form);
                atualizarTotais();
                saveState();
            });

            btnCancelarEdicao.addEventListener('click', function () {
                sairModoEdicao(form, btnAdicionar, btnCancelarEdicao);
                linhaEmEdicao = null;
                formEmEdicao = null;
                ocultarFormGasto(form);
            });
        });

        function ordenarTabelaPorVencimento(tbody) {
            const linhas = Array.from(tbody.querySelectorAll('tr'));
            linhas.sort(function (a, b) {
                const vA = a.dataset.vencimento || '';
                const vB = b.dataset.vencimento || '';
                return vA.localeCompare(vB);
            });
            linhas.forEach(function (tr) { tbody.appendChild(tr); });
        }

        function criarLinhaTabela(vencimento, descricao, tipo, valor, pago, usuario) {
            const tr = document.createElement('tr');
            tr.dataset.vencimento = vencimento;
            tr.dataset.descricao = descricao;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.dataset.pago = pago ? 'true' : 'false';
            if (usuario) tr.dataset.usuario = usuario;

            const checked = pago ? ' checked' : '';
            const tdUsuario = '<td class="col-usuario">' + escapeHtml(getNomeUsuario(usuario)) + '</td>';
            tr.innerHTML =
                '<td>' + formatarData(vencimento) + '</td>' +
                '<td>' + escapeHtml(descricao) + '</td>' +
                '<td>' + escapeHtml(tipo) + '</td>' +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
                tdUsuario +
                '<td class="col-pago"><input type="checkbox" class="check-pago" ' + checked + ' title="Marcar como pago"></td>' +
                '<td class="col-acoes">' +
                '  <button type="button" class="btn-tabela btn-editar btn-icone" title="Editar">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                '  </button>' +
                '  <button type="button" class="btn-tabela btn-excluir-linha btn-icone" title="Excluir">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
                '  </button>' +
                '</td>';
            return tr;
        }

        function atualizarLinha(tr, vencimento, descricao, tipo, valor, pago, usuario) {
            tr.dataset.vencimento = vencimento;
            tr.dataset.descricao = descricao;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.dataset.pago = pago ? 'true' : 'false';
            if (usuario !== undefined) tr.dataset.usuario = usuario || '';
            tr.cells[0].textContent = formatarData(vencimento);
            tr.cells[1].textContent = descricao;
            tr.cells[2].textContent = tipo;
            tr.cells[3].className = 'valor-real';
            tr.cells[3].textContent = 'R$ ' + formatarValor(valor);
            var colUsuario = tr.querySelector('td.col-usuario');
            if (colUsuario) colUsuario.textContent = getNomeUsuario(usuario);
            var colPagoTd = tr.querySelector('td.col-pago');
            if (colPagoTd) colPagoTd.innerHTML = '<input type="checkbox" class="check-pago" ' + (pago ? ' checked' : '') + ' title="Marcar como pago">';
            tr.querySelector('.check-pago').addEventListener('change', function () {
                tr.dataset.pago = this.checked ? 'true' : 'false';
                atualizarTotais();
                saveState();
            });
        }

        function vincularEventosLinha(tr, form, tabelaId, btnAdicionar, btnCancelarEdicao) {
            tr.querySelector('.check-pago').addEventListener('change', function () {
                tr.dataset.pago = this.checked ? 'true' : 'false';
                atualizarTotais();
                saveState();
            });

            tr.querySelector('.btn-editar').addEventListener('click', function () {
                if (linhaEmEdicao) return;
                entrarModoEdicao(tr, form, btnAdicionar, btnCancelarEdicao);
                linhaEmEdicao = tr;
                formEmEdicao = form;
            });

            tr.querySelector('.btn-excluir-linha').addEventListener('click', function () {
                abrirModalExcluir(tr);
            });
        }

        function entrarModoEdicao(tr, form, btnAdicionar, btnCancelarEdicao) {
            form.querySelector('[name="vencimento"]').value = tr.dataset.vencimento;
            form.querySelector('[name="descricao"]').value = tr.dataset.descricao;
            form.querySelector('[name="tipo"]').value = tr.dataset.tipo;
            form.querySelector('[name="valor"]').value = tr.dataset.valor;
            var usuarioSel = form.querySelector('[name="usuario"]');
            if (usuarioSel) usuarioSel.value = tr.dataset.usuario || '';
            btnAdicionar.textContent = 'Atualizar';
            btnCancelarEdicao.style.display = 'inline-block';
        }

        function sairModoEdicao(form, btnAdicionar, btnCancelarEdicao) {
            btnAdicionar.textContent = 'Adicionar';
            btnCancelarEdicao.style.display = 'none';
            form.reset();
        }

        function atualizarTotais() {
            let totalFixos = 0, totalVariaveis = 0, totalMensais = 0, totalReceitas = 0, totalGanhosFuturos = 0;

            document.querySelectorAll('#tabela-gastos-fixos tbody tr').forEach(function (tr) {
                totalFixos += parseFloat(tr.dataset.valor || 0);
            });
            document.querySelectorAll('#tabela-gastos-variaveis tbody tr').forEach(function (tr) {
                totalVariaveis += parseFloat(tr.dataset.valor || 0);
            });
            document.querySelectorAll('.tabela-gasto-mensal tbody tr').forEach(function (tr) {
                totalMensais += parseFloat(tr.dataset.valor || 0);
            });
            let totalLimitesMensais = 0;
            document.querySelectorAll('.card-gasto-mensal').forEach(function (card) {
                const limiteInput = card.querySelector('.input-limite');
                if (limiteInput) totalLimitesMensais += parsearValorMoeda(limiteInput.value);
            });
            document.querySelectorAll('#tabela-receitas tbody tr').forEach(function (tr) {
                totalReceitas += parseFloat(tr.dataset.valor || 0);
            });
            document.querySelectorAll('#tabela-ganhos-futuros tbody tr').forEach(function (tr) {
                totalGanhosFuturos += parseFloat(tr.dataset.valor || 0);
            });

            let totalGastoAtual = totalMensais;
            document.querySelectorAll('#tabela-gastos-fixos tbody tr').forEach(function (tr) {
                if (tr.dataset.pago === 'true') {
                    totalGastoAtual += parseFloat(tr.dataset.valor || 0);
                }
            });
            document.querySelectorAll('#tabela-gastos-variaveis tbody tr').forEach(function (tr) {
                if (tr.dataset.pago === 'true') {
                    totalGastoAtual += parseFloat(tr.dataset.valor || 0);
                }
            });
            const totalGastosGerais = totalFixos + totalVariaveis + totalLimitesMensais;
            const totalGeral = totalReceitas - totalGastoAtual;
            const totalProjecaoSaldo = (totalReceitas + totalGanhosFuturos) - totalGastosGerais;

            document.getElementById('total-fixos').textContent = 'R$ ' + formatarValor(totalFixos);
            document.getElementById('total-variaveis').textContent = 'R$ ' + formatarValor(totalVariaveis);
            document.getElementById('total-mensais').textContent = 'R$ ' + formatarValor(totalMensais);
            document.getElementById('total-gasto-atual').textContent = 'R$ ' + formatarValor(totalGastoAtual);
            document.getElementById('total-gastos-gerais').textContent = 'R$ ' + formatarValor(totalGastosGerais);
            const elProjecao = document.getElementById('total-projecao-saldo');
            elProjecao.textContent = 'R$ ' + formatarValor(totalProjecaoSaldo);
            elProjecao.classList.remove('projecao-positiva', 'projecao-negativa');
            if (totalProjecaoSaldo > 0) elProjecao.classList.add('projecao-positiva');
            else if (totalProjecaoSaldo < 0) elProjecao.classList.add('projecao-negativa');
            document.getElementById('total-receitas').textContent = 'R$ ' + formatarValor(totalReceitas);
            document.getElementById('total-ganhos-futuros').textContent = 'R$ ' + formatarValor(totalGanhosFuturos);
            document.getElementById('total-geral').textContent = 'R$ ' + formatarValor(totalGeral);

            var cabecalhoTotaisEl = document.getElementById('cabecalho-totais');
            var totalGeralEl = cabecalhoTotaisEl ? cabecalhoTotaisEl.querySelector('.total-item.total-geral') : null;
            if (cabecalhoTotaisEl) {
                cabecalhoTotaisEl.querySelectorAll('.total-item-usuario').forEach(function (el) { el.remove(); });
                var usuarios = state.usuarios || [];
                if (usuarios.length > 0 && totalGeralEl) {
                    usuarios.forEach(function (u) {
                        var entradas = 0, saidas = 0;
                        document.querySelectorAll('#tabela-receitas tbody tr').forEach(function (tr) {
                            if (tr.dataset.usuario === u.id) entradas += parseFloat(tr.dataset.valor || 0);
                        });
                        document.querySelectorAll('#tabela-ganhos-futuros tbody tr').forEach(function (tr) {
                            if (tr.dataset.usuario === u.id) entradas += parseFloat(tr.dataset.valor || 0);
                        });
                        document.querySelectorAll('#tabela-gastos-fixos tbody tr').forEach(function (tr) {
                            if (tr.dataset.usuario === u.id && tr.dataset.pago === 'true') saidas += parseFloat(tr.dataset.valor || 0);
                        });
                        document.querySelectorAll('#tabela-gastos-variaveis tbody tr').forEach(function (tr) {
                            if (tr.dataset.usuario === u.id && tr.dataset.pago === 'true') saidas += parseFloat(tr.dataset.valor || 0);
                        });
                        document.querySelectorAll('.tabela-gasto-mensal tbody tr').forEach(function (tr) {
                            if (tr.dataset.usuario === u.id) saidas += parseFloat(tr.dataset.valor || 0);
                        });
                        var card = document.createElement('div');
                        card.className = 'total-item total-item-usuario total-item-oculto';
                        card.title = u.nome + ' – Entradas e saídas no mês atual';
                        card.innerHTML = '<span class="total-label">' + escapeHtml(u.nome) + '</span><span class="total-valor">Entr. R$ ' + formatarValor(entradas) + ' | Saídas R$ ' + formatarValor(saidas) + '</span>';
                        cabecalhoTotaisEl.insertBefore(card, totalGeralEl);
                    });
                }
            }
        }

        function formatarData(dataStr) {
            if (!dataStr) return '';
            const [ano, mes, dia] = dataStr.split('-');
            return dia + '/' + mes + '/' + ano;
        }

        function formatarValor(valor) {
            return valor.toFixed(2).replace('.', ',');
        }

        function escapeHtml(texto) {
            const div = document.createElement('div');
            div.textContent = texto;
            return div.innerHTML;
        }

        function getNomeUsuario(id) {
            if (!id) return '';
            var u = (state.usuarios || []).find(function (x) { return x.id === id; });
            return u ? u.nome : '';
        }

        // Receitas - formulário e tabela
        const formReceitas = document.getElementById('form-receitas');
        if (formReceitas) {
            const btnAdicionarReceita = formReceitas.querySelector('.btn-adicionar');
            const btnCancelarReceita = formReceitas.querySelector('.btn-cancelar-edicao');

            formReceitas.addEventListener('submit', function (e) {
                e.preventDefault();
                const data = formReceitas.querySelector('[name="data"]').value;
                const tipo = formReceitas.querySelector('[name="tipo"]').value.trim();
                const valor = parseFloat(formReceitas.querySelector('[name="valor"]').value);
                const usuarioSel = formReceitas.querySelector('[name="usuario"]');
                const usuario = usuarioSel ? usuarioSel.value : '';

                if (!data || !tipo || isNaN(valor) || valor < 0) return;

                const tbody = document.querySelector('#tabela-receitas tbody');

                if (linhaEmEdicaoReceita) {
                    atualizarLinhaReceita(linhaEmEdicaoReceita, data, tipo, valor, usuario);
                    sairModoEdicaoReceita(btnAdicionarReceita, btnCancelarReceita);
                    linhaEmEdicaoReceita = null;
                    atualizarTotais();
                } else {
                    const tr = criarLinhaReceita(data, tipo, valor, usuario);
                    tbody.appendChild(tr);
                    vincularEventosLinhaReceita(tr, btnAdicionarReceita, btnCancelarReceita);
                }
                formReceitas.reset();
                formReceitas.classList.remove('visivel');
                atualizarTotais();
                saveState();
            });

            btnCancelarReceita.addEventListener('click', function () {
                sairModoEdicaoReceita(btnAdicionarReceita, btnCancelarReceita);
                linhaEmEdicaoReceita = null;
                formReceitas.classList.remove('visivel');
            });
        }

        // Ganhos Futuros - formulário e tabela
        let linhaEmEdicaoGanhosFuturos = null;
        const formGanhosFuturos = document.getElementById('form-ganhos-futuros');
        if (formGanhosFuturos) {
            const btnAdicionarGF = formGanhosFuturos.querySelector('.btn-adicionar');
            const btnCancelarGF = formGanhosFuturos.querySelector('.btn-cancelar-edicao');

            formGanhosFuturos.addEventListener('submit', function (e) {
                e.preventDefault();
                const data = formGanhosFuturos.querySelector('[name="data"]').value;
                const tipo = formGanhosFuturos.querySelector('[name="tipo"]').value.trim();
                const valor = parseFloat(formGanhosFuturos.querySelector('[name="valor"]').value);
                const usuarioSel = formGanhosFuturos.querySelector('[name="usuario"]');
                const usuario = usuarioSel ? usuarioSel.value : '';

                if (!data || !tipo || isNaN(valor) || valor < 0) return;

                const tbody = document.querySelector('#tabela-ganhos-futuros tbody');

                if (linhaEmEdicaoGanhosFuturos) {
                    atualizarLinhaGanhosFuturos(linhaEmEdicaoGanhosFuturos, data, tipo, valor, usuario);
                    sairModoEdicaoGanhosFuturos(btnAdicionarGF, btnCancelarGF);
                    linhaEmEdicaoGanhosFuturos = null;
                    atualizarTotais();
                } else {
                    const tr = criarLinhaGanhosFuturos(data, tipo, valor, usuario);
                    tbody.appendChild(tr);
                    vincularEventosLinhaGanhosFuturos(tr, btnAdicionarGF, btnCancelarGF);
                }
                formGanhosFuturos.reset();
                formGanhosFuturos.classList.remove('visivel');
                atualizarTotais();
                saveState();
            });

            btnCancelarGF.addEventListener('click', function () {
                sairModoEdicaoGanhosFuturos(btnAdicionarGF, btnCancelarGF);
                linhaEmEdicaoGanhosFuturos = null;
                formGanhosFuturos.classList.remove('visivel');
            });
        }

        function criarLinhaGanhosFuturos(data, tipo, valor, usuario) {
            const tr = document.createElement('tr');
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            if (usuario) tr.dataset.usuario = usuario;
            tr.innerHTML =
                '<td>' + formatarData(data) + '</td>' +
                '<td>' + escapeHtml(tipo) + '</td>' +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
                '<td class="col-usuario">' + escapeHtml(getNomeUsuario(usuario)) + '</td>' +
                '<td class="col-acoes">' +
                '  <button type="button" class="btn-tabela btn-editar btn-icone" title="Editar">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                '  </button>' +
                '  <button type="button" class="btn-tabela btn-excluir-linha btn-icone" title="Excluir">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
                '  </button>' +
                '</td>';
            return tr;
        }

        function atualizarLinhaGanhosFuturos(tr, data, tipo, valor, usuario) {
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            if (usuario !== undefined) tr.dataset.usuario = usuario || '';
            tr.cells[0].textContent = formatarData(data);
            tr.cells[1].textContent = tipo;
            tr.cells[2].className = 'valor-real';
            tr.cells[2].textContent = 'R$ ' + formatarValor(valor);
            var colU = tr.querySelector('td.col-usuario');
            if (colU) colU.textContent = getNomeUsuario(usuario);
        }

        function vincularEventosLinhaGanhosFuturos(tr, btnAdicionarGF, btnCancelarGF) {
            tr.querySelector('.btn-editar').addEventListener('click', function () {
                if (linhaEmEdicaoGanhosFuturos) return;
                formGanhosFuturos.querySelector('[name="data"]').value = tr.dataset.data;
                formGanhosFuturos.querySelector('[name="tipo"]').value = tr.dataset.tipo;
                formGanhosFuturos.querySelector('[name="valor"]').value = tr.dataset.valor;
                var usuarioSel = formGanhosFuturos.querySelector('[name="usuario"]');
                if (usuarioSel) usuarioSel.value = tr.dataset.usuario || '';
                btnAdicionarGF.textContent = 'Atualizar';
                btnCancelarGF.style.display = 'inline-block';
                linhaEmEdicaoGanhosFuturos = tr;
            });

            tr.querySelector('.btn-excluir-linha').addEventListener('click', function () {
                abrirModalExcluir(tr);
            });
        }

        function sairModoEdicaoGanhosFuturos(btnAdicionarGF, btnCancelarGF) {
            btnAdicionarGF.textContent = 'Adicionar';
            btnCancelarGF.style.display = 'none';
            formGanhosFuturos.reset();
        }

        function criarLinhaReceita(data, tipo, valor, usuario) {
            const tr = document.createElement('tr');
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            if (usuario) tr.dataset.usuario = usuario;
            tr.innerHTML =
                '<td>' + formatarData(data) + '</td>' +
                '<td>' + escapeHtml(tipo) + '</td>' +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
                '<td class="col-usuario">' + escapeHtml(getNomeUsuario(usuario)) + '</td>' +
                '<td class="col-acoes">' +
                '  <button type="button" class="btn-tabela btn-editar btn-icone" title="Editar">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                '  </button>' +
                '  <button type="button" class="btn-tabela btn-excluir-linha btn-icone" title="Excluir">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
                '  </button>' +
                '</td>';
            return tr;
        }

        function atualizarLinhaReceita(tr, data, tipo, valor, usuario) {
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            if (usuario !== undefined) tr.dataset.usuario = usuario || '';
            tr.cells[0].textContent = formatarData(data);
            tr.cells[1].textContent = tipo;
            tr.cells[2].className = 'valor-real';
            tr.cells[2].textContent = 'R$ ' + formatarValor(valor);
            var colU = tr.querySelector('td.col-usuario');
            if (colU) colU.textContent = getNomeUsuario(usuario);
        }

        function vincularEventosLinhaReceita(tr, btnAdicionarReceita, btnCancelarReceita) {
            tr.querySelector('.btn-editar').addEventListener('click', function () {
                if (linhaEmEdicaoReceita) return;
                formReceitas.querySelector('[name="data"]').value = tr.dataset.data;
                formReceitas.querySelector('[name="tipo"]').value = tr.dataset.tipo;
                formReceitas.querySelector('[name="valor"]').value = tr.dataset.valor;
                var usuarioSel = formReceitas.querySelector('[name="usuario"]');
                if (usuarioSel) usuarioSel.value = tr.dataset.usuario || '';
                btnAdicionarReceita.textContent = 'Atualizar';
                btnCancelarReceita.style.display = 'inline-block';
                linhaEmEdicaoReceita = tr;
            });

            tr.querySelector('.btn-excluir-linha').addEventListener('click', function () {
                abrirModalExcluir(tr);
            });
        }

        function sairModoEdicaoReceita(btnAdicionarReceita, btnCancelarReceita) {
            btnAdicionarReceita.textContent = 'Adicionar';
            btnCancelarReceita.style.display = 'none';
            formReceitas.reset();
        }

        // Movimentações Diversas - botão que cria novos campos
        let linhaEmEdicaoMensal = null;
        let cardEmEdicaoMensal = null;
        const btnAdicionarGastoMensal = document.getElementById('btn-adicionar-gasto-mensal');
        const listaGastosMensais = document.getElementById('lista-gastos-mensais');
        const selectMovimentacoes = document.getElementById('select-movimentacoes');

        function aplicarVisibilidadeCardMovimentacao() {
            var sel = document.getElementById('select-movimentacoes');
            var list = document.getElementById('lista-gastos-mensais');
            if (!sel || !list) return;
            var val = sel.value;
            list.querySelectorAll('.card-gasto-mensal').forEach(function (card) {
                card.style.display = (val && card.dataset.id === val) ? '' : 'none';
            });
        }

        function atualizarSelectMovimentacoes() {
            var sel = document.getElementById('select-movimentacoes');
            var list = document.getElementById('lista-gastos-mensais');
            if (!sel || !list) return;
            var cards = list.querySelectorAll('.card-gasto-mensal');
            var selected = sel.value;
            sel.innerHTML = '';
            if (cards.length === 0) {
                sel.appendChild(new Option('Nenhuma movimentação', ''));
                sel.value = '';
            } else {
                for (var i = 0; i < cards.length; i++) {
                    var card = cards[i];
                    var tituloEl = card.querySelector('.titulo-bloco');
                    var titulo = tituloEl ? tituloEl.textContent.trim() : '';
                    if (!titulo) titulo = 'Bloco ' + (i + 1);
                    sel.appendChild(new Option(titulo, card.dataset.id || ''));
                }
                if (selected && list.querySelector('.card-gasto-mensal[data-id="' + selected + '"]')) {
                    sel.value = selected;
                } else {
                    sel.value = cards[0].dataset.id || '';
                }
                aplicarVisibilidadeCardMovimentacao();
            }
        }

        function criarCardGastoMensal(dados) {
            const id = dados && dados.id ? dados.id : 'gasto-mensal-' + Date.now();
            const card = document.createElement('div');
            card.className = 'card-gasto-mensal';
            card.dataset.id = id;
            card.innerHTML =
                '<div class="card-gasto-mensal-cabecalho">' +
                '  <div class="card-gasto-mensal-arrastar" draggable="true" aria-label="Arrastar para reordenar" title="Arrastar para reordenar">' +
                '    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
                '  </div>' +
                '  <div class="titulo-bloco" contenteditable="true" data-placeholder="Nome do bloco"></div>' +
                '  <button type="button" class="btn-excluir-gasto" aria-label="Excluir este gasto">×</button>' +
                '</div>' +
                '<button type="button" class="card-gasto-mensal-toggle" aria-label="Exibir ou ocultar conteúdo do bloco" title="Clique para exibir ou ocultar">' +
                '  <svg class="card-gasto-mensal-chevron" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                '</button>' +
                '<div class="card-gasto-mensal-corpo">' +
                '<div class="card-gasto-mensal-limite">' +
                '  <label>Limite de gasto</label>' +
                '  <div class="limite-linha">' +
                '    <div class="input-limite-wrapper">' +
                '      <span class="prefixo-moeda">R$</span>' +
                '      <input type="text" class="input-limite" placeholder="0,00" inputmode="decimal" title="Valor limite para este bloco">' +
                '    </div>' +
                '    <span class="gasto-total-card" title="Total gasto neste bloco"></span>' +
                '    <span class="disponivel-gasto" title="Valor que ainda pode ser gasto neste bloco"></span>' +
                '  </div>' +
                '</div>' +
                '<div class="card-gasto-mensal-form">' +
                '  <div class="campo">' +
                '    <label>Data do gasto</label>' +
                '    <input type="date" name="data" required>' +
                '  </div>' +
                '  <div class="campo campo-descricao-mensal">' +
                '    <label>Descrição</label>' +
                '    <input type="text" name="descricao" placeholder="Ex: Compras diversas">' +
                '  </div>' +
                '  <div class="campo">' +
                '    <label>Valor</label>' +
                '    <input type="number" name="valor" placeholder="0,00" step="0.01" min="0" required>' +
                '  </div>' +
                '  <div class="form-botoes-mensal">' +
                '    <button type="button" class="btn-adicionar-item">Adicionar item</button>' +
                '    <button type="button" class="btn-cancelar-edicao-mensal" style="display:none">Cancelar</button>' +
                '  </div>' +
                '</div>' +
                '<table class="tabela-gasto-mensal">' +
                '  <thead><tr><th>Data</th><th>Descrição</th><th>Valor</th><th>Ações</th></tr></thead>' +
                '  <tbody></tbody></table>' +
                '</div>';
            listaGastosMensais.appendChild(card);

            var toggleBtn = card.querySelector('.card-gasto-mensal-toggle');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    card.classList.toggle('card-gasto-mensal-aberto');
                });
            }

            var handleArrastar = card.querySelector('.card-gasto-mensal-arrastar');
            if (handleArrastar) {
                handleArrastar.addEventListener('dragstart', function (ev) {
                    ev.dataTransfer.setData('text/plain', card.dataset.id);
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setDragImage(card, 20, 10);
                    card.classList.add('card-arrastando');
                });
                handleArrastar.addEventListener('dragend', function () {
                    card.classList.remove('card-arrastando');
                    listaGastosMensais.querySelectorAll('.card-gasto-mensal').forEach(function (c) { c.classList.remove('card-drop-target'); });
                });
            }

            if (dados) {
                const tituloEl = card.querySelector('.titulo-bloco');
                if (dados.titulo) tituloEl.textContent = dados.titulo;
                aplicarEstruturaOutros(card);
                const limiteInput = card.querySelector('.input-limite');
                if (dados.limite != null && dados.limite > 0) {
                    const partes = dados.limite.toFixed(2).split('.');
                    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                    limiteInput.value = partes.join(',');
                }
                const tbody = card.querySelector('.tabela-gasto-mensal tbody');
                if (dados.items && dados.items.length) {
                    dados.items.forEach(function (item) {
                        const descricao = item.descricao || '';
                        const tr = criarLinhaGastoMensal(item.data, item.valor, descricao, item.usuario);
                        tbody.appendChild(tr);
                        vincularEventosLinhaMensal(tr, card);
                    });
                    verificarLimiteCard(card);
                }
            }

            card.querySelector('.btn-excluir-gasto').addEventListener('click', function () {
                abrirModalExcluir(card);
            });

            card.querySelector('.btn-adicionar-item').addEventListener('click', function () {
                const dataInput = card.querySelector('[name="data"]');
                const valorInput = card.querySelector('[name="valor"]');
                const descricaoInput = card.querySelector('[name="descricao"]');
                const btnAdicionar = card.querySelector('.btn-adicionar-item');
                const btnCancelar = card.querySelector('.btn-cancelar-edicao-mensal');

                const data = dataInput.value;
                const valor = parseFloat(valorInput.value);
                const descricao = descricaoInput ? descricaoInput.value.trim() : '';
                var usuarioSel = card.querySelector('select[name="usuario"]');
                var usuario = usuarioSel ? usuarioSel.value : '';

                if (!data || isNaN(valor) || valor < 0) return;

                const tbody = card.querySelector('.tabela-gasto-mensal tbody');
                const colValorIdx = 2;
                const colDescIdx = 1;

                if (linhaEmEdicaoMensal && cardEmEdicaoMensal === card) {
                    linhaEmEdicaoMensal.dataset.data = data;
                    linhaEmEdicaoMensal.dataset.valor = valor;
                    linhaEmEdicaoMensal.dataset.descricao = descricao || '';
                    if (usuario !== undefined) linhaEmEdicaoMensal.dataset.usuario = usuario || '';
                    linhaEmEdicaoMensal.cells[colDescIdx].textContent = descricao || '';
                    linhaEmEdicaoMensal.cells[0].textContent = formatarData(data);
                    linhaEmEdicaoMensal.cells[colValorIdx].textContent = 'R$ ' + formatarValor(valor);
                    linhaEmEdicaoMensal.cells[colValorIdx].className = 'valor-real';
                    var colU = linhaEmEdicaoMensal.querySelector('td.col-usuario');
                    if (colU) colU.textContent = getNomeUsuario(usuario);
                    sairEdicaoMensal(card);
                    linhaEmEdicaoMensal = null;
                    cardEmEdicaoMensal = null;
                } else {
                    const tr = criarLinhaGastoMensal(data, valor, descricao, usuario);
                    tbody.appendChild(tr);
                    vincularEventosLinhaMensal(tr, card);
                }

                dataInput.value = '';
                valorInput.value = '';
                if (descricaoInput) descricaoInput.value = '';
                atualizarTotais();
                verificarLimiteCard(card);
                saveState();
            });

            card.querySelector('.btn-cancelar-edicao-mensal').addEventListener('click', function () {
                sairEdicaoMensal(card);
                linhaEmEdicaoMensal = null;
                cardEmEdicaoMensal = null;
            });

            const limiteInput = card.querySelector('.input-limite');
            limiteInput.addEventListener('input', function () {
                formatarInputMoeda(this);
                verificarLimiteCard(card);
                atualizarTotais();
                saveState();
            });
            limiteInput.addEventListener('blur', function () {
                formatarInputMoedaBlur(this);
                atualizarTotais();
                saveState();
            });
            card.querySelector('.titulo-bloco').addEventListener('input', function () {
                aplicarEstruturaOutros(card);
                saveState();
            });
            card.querySelector('.titulo-bloco').addEventListener('blur', function () {
                aplicarEstruturaOutros(card);
                saveState();
                atualizarSelectMovimentacoes();
            });
            aplicarEstruturaOutros(card);
            verificarLimiteCard(card);
            return card;
        }

        if (selectMovimentacoes) {
            selectMovimentacoes.addEventListener('change', aplicarVisibilidadeCardMovimentacao);
        }

        btnAdicionarGastoMensal.addEventListener('click', function () {
            var card = criarCardGastoMensal(null);
            applyVisibilityUsuarios();
            saveState();
            setTimeout(function () {
                atualizarSelectMovimentacoes();
                var sel = document.getElementById('select-movimentacoes');
                if (sel && card && card.dataset && card.dataset.id) {
                    sel.value = card.dataset.id;
                    aplicarVisibilidadeCardMovimentacao();
                }
            }, 0);
        });

        (function setupArrastarCards() {
            listaGastosMensais.addEventListener('dragover', function (ev) {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                var targetCard = ev.target && ev.target.closest ? ev.target.closest('.card-gasto-mensal') : null;
                listaGastosMensais.querySelectorAll('.card-gasto-mensal').forEach(function (c) { c.classList.remove('card-drop-target'); });
                if (targetCard && !targetCard.classList.contains('card-arrastando')) targetCard.classList.add('card-drop-target');
            });
            listaGastosMensais.addEventListener('drop', function (ev) {
                ev.preventDefault();
                listaGastosMensais.querySelectorAll('.card-gasto-mensal').forEach(function (c) { c.classList.remove('card-drop-target'); });
                var id = ev.dataTransfer.getData('text/plain');
                if (!id) return;
                var card = listaGastosMensais.querySelector('.card-gasto-mensal[data-id="' + id + '"]');
                var targetCard = ev.target && ev.target.closest ? ev.target.closest('.card-gasto-mensal') : null;
                if (!card || !targetCard || card === targetCard) return;
                listaGastosMensais.insertBefore(card, targetCard);
                saveState();
            });
        })();

        function ehCardOutros(card) {
            const titulo = (card.querySelector('.titulo-bloco') || {}).textContent || '';
            return titulo.trim().toLowerCase() === 'outros';
        }

        function aplicarEstruturaOutros(card) {
            /* Todos os cards têm coluna Descrição; não remove mais. */
        }

        function criarLinhaGastoMensal(data, valor, descricao, usuario) {
            const tr = document.createElement('tr');
            tr.dataset.data = data;
            tr.dataset.valor = valor;
            tr.dataset.descricao = (descricao !== undefined && descricao !== null) ? (descricao || '') : '';
            if (usuario) tr.dataset.usuario = usuario;
            const hasUsers = (state.usuarios || []).length > 0;
            const tdUsuario = hasUsers ? ('<td class="col-usuario">' + escapeHtml(getNomeUsuario(usuario)) + '</td>') : '';
            tr.innerHTML =
                '<td>' + formatarData(data) + '</td>' +
                '<td>' + escapeHtml(tr.dataset.descricao) + '</td>' +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
                tdUsuario +
                '<td class="col-acoes">' +
                '  <button type="button" class="btn-tabela btn-editar btn-icone" title="Editar">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                '  </button>' +
                '  <button type="button" class="btn-tabela btn-excluir-linha btn-icone" title="Excluir">' +
                '    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
                '  </button>' +
                '</td>';
            return tr;
        }

        function vincularEventosLinhaMensal(tr, card) {
            tr.querySelector('.btn-editar').addEventListener('click', function () {
                if (linhaEmEdicaoMensal) return;
                card.querySelector('[name="data"]').value = tr.dataset.data || '';
                card.querySelector('[name="valor"]').value = tr.dataset.valor || '';
                const descricaoInput = card.querySelector('[name="descricao"]');
                if (descricaoInput) descricaoInput.value = tr.dataset.descricao || '';
                var usuarioSel = card.querySelector('select[name="usuario"]');
                if (usuarioSel) usuarioSel.value = tr.dataset.usuario || '';
                card.querySelector('.btn-adicionar-item').textContent = 'Atualizar';
                card.querySelector('.btn-cancelar-edicao-mensal').style.display = 'inline-block';
                linhaEmEdicaoMensal = tr;
                cardEmEdicaoMensal = card;
            });
            tr.querySelector('.btn-excluir-linha').addEventListener('click', function () {
                abrirModalExcluir(tr);
            });
        }

        function sairEdicaoMensal(card) {
            card.querySelector('.btn-adicionar-item').textContent = 'Adicionar item';
            card.querySelector('.btn-cancelar-edicao-mensal').style.display = 'none';
            card.querySelector('[name="data"]').value = '';
            card.querySelector('[name="valor"]').value = '';
            const descricaoInput = card.querySelector('[name="descricao"]');
            if (descricaoInput) descricaoInput.value = '';
        }

        function parsearValorMoeda(str) {
            if (!str || !str.trim()) return 0;
            const limpo = str.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
            return parseFloat(limpo) || 0;
        }

        function formatarInputMoeda(input) {
            let valor = input.value.replace(/\D/g, '');
            if (valor.length > 2) {
                valor = valor.replace(/^0+/, '') || '0';
                const inteiros = valor.slice(0, -2);
                const decimais = valor.slice(-2);
                valor = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + decimais;
            } else if (valor.length === 2) {
                valor = '0,' + valor;
            } else if (valor.length === 1 && valor !== '0') {
                valor = '0,0' + valor;
            } else if (valor === '0' || valor === '') {
                valor = '';
            }
            input.value = valor;
        }

        function formatarInputMoedaBlur(input) {
            const num = parsearValorMoeda(input.value);
            if (num > 0) {
                const partes = num.toFixed(2).split('.');
                partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                input.value = partes.join(',');
            }
        }

        function verificarLimiteCard(card) {
            const limiteInput = card.querySelector('.input-limite');
            const limite = parsearValorMoeda(limiteInput ? limiteInput.value : '');
            let total = 0;
            card.querySelectorAll('.tabela-gasto-mensal tbody tr').forEach(function (tr) {
                total += parseFloat(tr.dataset.valor || 0);
            });
            if (limite > 0 && total > limite) {
                card.classList.add('limite-ultrapassado');
            } else {
                card.classList.remove('limite-ultrapassado');
            }
            const gastoTotalEl = card.querySelector('.gasto-total-card');
            if (gastoTotalEl) {
                gastoTotalEl.textContent = 'Gastos: R$ ' + formatarValor(total);
                gastoTotalEl.style.display = total > 0 || limite > 0 ? '' : 'none';
            }
            const disponivelEl = card.querySelector('.disponivel-gasto');
            if (disponivelEl) {
                if (limite > 0) {
                    const disponivel = Math.max(0, limite - total);
                    disponivelEl.textContent = 'Saldo: R$ ' + formatarValor(disponivel);
                    disponivelEl.style.color = disponivel > 0 ? '#16a34a' : '#dc2626';
                    disponivelEl.style.display = '';
                } else {
                    disponivelEl.textContent = '';
                    disponivelEl.style.display = 'none';
                }
            }
        }

        function getStateFromDOM() {
            const gastosFixos = [];
            document.querySelectorAll('#tabela-gastos-fixos tbody tr').forEach(function (tr) {
                var o = {
                    vencimento: tr.dataset.vencimento,
                    descricao: tr.dataset.descricao,
                    tipo: tr.dataset.tipo,
                    valor: parseFloat(tr.dataset.valor || 0),
                    pago: tr.dataset.pago === 'true'
                };
                if (tr.dataset.usuario) o.usuario = tr.dataset.usuario;
                gastosFixos.push(o);
            });
            const gastosVariaveis = [];
            document.querySelectorAll('#tabela-gastos-variaveis tbody tr').forEach(function (tr) {
                var o = {
                    vencimento: tr.dataset.vencimento,
                    descricao: tr.dataset.descricao,
                    tipo: tr.dataset.tipo,
                    valor: parseFloat(tr.dataset.valor || 0),
                    pago: tr.dataset.pago === 'true'
                };
                if (tr.dataset.usuario) o.usuario = tr.dataset.usuario;
                gastosVariaveis.push(o);
            });
            const gastosMensais = [];
            document.querySelectorAll('.card-gasto-mensal').forEach(function (card) {
                const titulo = (card.querySelector('.titulo-bloco') || {}).textContent || '';
                const limiteInput = card.querySelector('.input-limite');
                const limite = parsearValorMoeda(limiteInput ? limiteInput.value : '');
                const items = [];
                card.querySelectorAll('.tabela-gasto-mensal tbody tr').forEach(function (tr) {
                    const item = { data: tr.dataset.data, valor: parseFloat(tr.dataset.valor || 0), descricao: tr.dataset.descricao || '' };
                    if (tr.dataset.usuario) item.usuario = tr.dataset.usuario;
                    items.push(item);
                });
                gastosMensais.push({ id: card.dataset.id, titulo: titulo, limite: limite, items: items });
            });
            const receitas = [];
            document.querySelectorAll('#tabela-receitas tbody tr').forEach(function (tr) {
                var o = { data: tr.dataset.data, tipo: tr.dataset.tipo, valor: parseFloat(tr.dataset.valor || 0) };
                if (tr.dataset.usuario) o.usuario = tr.dataset.usuario;
                receitas.push(o);
            });
            const ganhosFuturos = [];
            document.querySelectorAll('#tabela-ganhos-futuros tbody tr').forEach(function (tr) {
                var o = { data: tr.dataset.data, tipo: tr.dataset.tipo, valor: parseFloat(tr.dataset.valor || 0) };
                if (tr.dataset.usuario) o.usuario = tr.dataset.usuario;
                ganhosFuturos.push(o);
            });
            return { gastosFixos, gastosVariaveis, gastosMensais, receitas, ganhosFuturos };
        }

        function saveState() {
            if (state.mesAtivo) {
                state.meses[state.mesAtivo] = getStateFromDOM();
            }
            saveToDB(state);
        }

        function applyVisibilityUsuarios() {
            var usuarios = state.usuarios || [];
            var hasUsers = usuarios.length > 0;
            document.body.classList.toggle('has-usuarios', hasUsers);
            ['campo-dono-fixo', 'campo-dono-variavel', 'campo-dono-receitas', 'campo-dono-ganhos-futuros'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.style.display = hasUsers ? '' : 'none';
            });
            var opts = '<option value="">— Nenhum —</option>';
            usuarios.forEach(function (u) {
                opts += '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.nome) + '</option>';
            });
            ['fixo-usuario', 'variavel-usuario', 'receita-usuario', 'ganhos-futuros-usuario'].forEach(function (id) {
                var sel = document.getElementById(id);
                if (sel) {
                    var val = sel.value;
                    sel.innerHTML = opts;
                    if (val && usuarios.some(function (u) { return u.id === val; })) sel.value = val;
                }
            });
            document.querySelectorAll('.card-gasto-mensal').forEach(function (card) {
                var form = card.querySelector('.card-gasto-mensal-form');
                var thead = card.querySelector('.tabela-gasto-mensal thead tr');
                if (!form || !thead) return;
                var campoDono = form.querySelector('.campo-dono-mensal');
                if (hasUsers) {
                    if (!campoDono) {
                        var div = document.createElement('div');
                        div.className = 'campo campo-dono-mensal';
                        div.innerHTML = '<label>Dono</label><select name="usuario"><option value="">— Nenhum —</option></select>';
                        form.querySelector('.form-botoes-mensal').before(div);
                    }
                    var sel = form.querySelector('select[name="usuario"]');
                    if (sel) {
                        var v = sel.value;
                        sel.innerHTML = opts;
                        if (v && usuarios.some(function (u) { return u.id === v; })) sel.value = v;
                    }
                    if (!thead.querySelector('th.col-usuario')) {
                        var th = document.createElement('th');
                        th.className = 'col-usuario';
                        th.textContent = 'Dono';
                        var lastTh = thead.querySelector('th:last-child');
                        if (lastTh) thead.insertBefore(th, lastTh);
                        else thead.appendChild(th);
                    }
                } else {
                    if (campoDono) campoDono.remove();
                    var thU = thead.querySelector('th.col-usuario');
                    if (thU) thU.remove();
                }
            });
        }

        function renderYearTabs() {
            var listaAnos = document.getElementById('lista-anos');
            listaAnos.innerHTML = '';
            getAnos().forEach(function (ano) {
                var tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'ano-tab' + (ano === state.anoAtivo ? ' ativo' : '');
                tab.innerHTML = '<span class="ano-tab-texto">' + escapeHtml(ano) + '</span>';
                tab.dataset.ano = ano;
                tab.setAttribute('aria-label', 'Ano ' + ano);
                tab.addEventListener('click', function () {
                    state.anoAtivo = ano;
                    var mesesDoAno = getMesesDoAno(ano);
                    var mesAtivoNoAno = state.mesAtivo && state.mesAtivo.indexOf(ano + '-') === 0;
                    if (!mesAtivoNoAno && mesesDoAno.length > 0) {
                        state.meses[state.mesAtivo] = getStateFromDOM();
                        state.mesAtivo = mesesDoAno[0];
                        restoreState(state.meses[state.mesAtivo] || getEmptyMonthData());
                    }
                    renderYearTabs();
                    renderMonthTabs();
                    atualizarTotais();
                    saveState();
                });
                listaAnos.appendChild(tab);
            });
        }

        function renderMonthTabs() {
            var listaMeses = document.getElementById('lista-meses');
            listaMeses.innerHTML = '';
            var chaves = getMesesDoAno(state.anoAtivo);
            if (chaves.length === 0 && state.mesAtivo) {
                state.anoAtivo = state.mesAtivo.split('-')[0];
                chaves = getMesesDoAno(state.anoAtivo);
                renderYearTabs();
            }
            if (state.mesAtivo && chaves.indexOf(state.mesAtivo) === -1 && chaves.length > 0) {
                state.meses[state.mesAtivo] = getStateFromDOM();
                state.mesAtivo = chaves[0];
                restoreState(state.meses[state.mesAtivo] || getEmptyMonthData());
            }
            chaves.forEach(function (chave) {
                var tab = document.createElement('div');
                tab.className = 'mes-tab' + (chave === state.mesAtivo ? ' ativo' : '');
                tab.dataset.mes = chave;
                tab.setAttribute('role', 'button');
                tab.setAttribute('tabindex', '0');
                tab.setAttribute('aria-label', 'Mês ' + formatarNomeMes(chave));
                tab.innerHTML =
                    '<span class="mes-tab-texto">' + escapeHtml(formatarNomeMes(chave)) + '</span>' +
                    '<button type="button" class="mes-tab-excluir" title="Excluir aba deste mês" aria-label="Excluir ' + escapeHtml(formatarNomeMes(chave)) + '">×</button>';
                tab.addEventListener('click', function (e) {
                    if (e.target.classList.contains('mes-tab-excluir')) return;
                    switchToMonth(chave);
                });
                tab.querySelector('.mes-tab-excluir').addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (chave === state.mesAtivo) {
                        state.meses[chave] = getStateFromDOM();
                    }
                    if (hasMonthData(chave)) {
                        tabParaExcluirAposAviso = tab;
                        modalAvisoDados.classList.add('ativo');
                        modalAvisoDados.setAttribute('aria-hidden', 'false');
                    } else {
                        abrirModalExcluir(tab);
                    }
                });
                tab.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (e.target.classList.contains('mes-tab-excluir')) return;
                        switchToMonth(chave);
                    }
                });
                listaMeses.appendChild(tab);
            });
        }

        function switchToMonth(chave) {
            if (chave === state.mesAtivo) return;
            state.meses[state.mesAtivo] = getStateFromDOM();
            state.mesAtivo = chave;
            state.anoAtivo = chave.split('-')[0];
            restoreState(state.meses[chave] || getEmptyMonthData());
            renderYearTabs();
            renderMonthTabs();
            atualizarTotais();
            saveState();
        }

        function restoreState(monthData) {
            const formFixo = document.querySelector('.formulario-gasto[data-tipo="fixo"]');
            const formVariavel = document.querySelector('.formulario-gasto[data-tipo="variavel"]');
            const tbodyFixos = document.querySelector('#tabela-gastos-fixos tbody');
            const tbodyVariaveis = document.querySelector('#tabela-gastos-variaveis tbody');
            const btnFixo = formFixo ? formFixo.querySelector('.btn-adicionar') : null;
            const btnVar = formVariavel ? formVariavel.querySelector('.btn-adicionar') : null;
            const btnCancelFixo = formFixo ? formFixo.querySelector('.btn-cancelar-edicao') : null;
            const btnCancelVar = formVariavel ? formVariavel.querySelector('.btn-cancelar-edicao') : null;

            tbodyFixos.innerHTML = '';
            (monthData.gastosFixos || []).slice().sort(function (a, b) {
                return (a.vencimento || '').localeCompare(b.vencimento || '');
            }).forEach(function (g) {
                const tr = criarLinhaTabela(g.vencimento, g.descricao, g.tipo, g.valor, g.pago, g.usuario);
                tbodyFixos.appendChild(tr);
                vincularEventosLinha(tr, formFixo, 'tabela-gastos-fixos', btnFixo, btnCancelFixo);
            });
            tbodyVariaveis.innerHTML = '';
            (monthData.gastosVariaveis || []).slice().sort(function (a, b) {
                return (a.vencimento || '').localeCompare(b.vencimento || '');
            }).forEach(function (g) {
                const tr = criarLinhaTabela(g.vencimento, g.descricao, g.tipo, g.valor, g.pago, g.usuario);
                tbodyVariaveis.appendChild(tr);
                vincularEventosLinha(tr, formVariavel, 'tabela-gastos-variaveis', btnVar, btnCancelVar);
            });

            listaGastosMensais.innerHTML = '';
            (monthData.gastosMensais || []).forEach(function (c) {
                criarCardGastoMensal(c);
            });
            atualizarSelectMovimentacoes();

            const tbodyReceitas = document.querySelector('#tabela-receitas tbody');
            const tbodyGanhosFuturos = document.querySelector('#tabela-ganhos-futuros tbody');
            tbodyReceitas.innerHTML = '';
            (monthData.receitas || []).forEach(function (r) {
                const tr = criarLinhaReceita(r.data, r.tipo, r.valor, r.usuario);
                tbodyReceitas.appendChild(tr);
                vincularEventosLinhaReceita(tr, formReceitas.querySelector('.btn-adicionar'), formReceitas.querySelector('.btn-cancelar-edicao'));
            });
            tbodyGanhosFuturos.innerHTML = '';
            (monthData.ganhosFuturos || []).forEach(function (g) {
                const tr = criarLinhaGanhosFuturos(g.data, g.tipo, g.valor, g.usuario);
                tbodyGanhosFuturos.appendChild(tr);
                vincularEventosLinhaGanhosFuturos(tr, formGanhosFuturos.querySelector('.btn-adicionar'), formGanhosFuturos.querySelector('.btn-cancelar-edicao'));
            });
        }

        // Modal de aviso (mês com dados)
        var modalAvisoDados = document.getElementById('modal-aviso-dados');
        var btnAvisoDadosCancelar = document.getElementById('modal-aviso-dados-cancelar');
        var btnAvisoDadosContinuar = document.getElementById('modal-aviso-dados-continuar');
        var tabParaExcluirAposAviso = null;

        function fecharModalAvisoDados() {
            tabParaExcluirAposAviso = null;
            modalAvisoDados.classList.remove('ativo');
            modalAvisoDados.setAttribute('aria-hidden', 'true');
        }

        btnAvisoDadosCancelar.addEventListener('click', fecharModalAvisoDados);
        btnAvisoDadosContinuar.addEventListener('click', function () {
            if (tabParaExcluirAposAviso) {
                var tab = tabParaExcluirAposAviso;
                tabParaExcluirAposAviso = null;
                fecharModalAvisoDados();
                abrirModalExcluir(tab);
            }
        });
        modalAvisoDados.addEventListener('click', function (e) {
            if (e.target === modalAvisoDados) fecharModalAvisoDados();
        });

        // Modal de confirmação para excluir
        const modalExcluir = document.getElementById('modal-excluir');
        const btnModalCancelar = document.getElementById('modal-cancelar');
        const btnModalConfirmar = document.getElementById('modal-confirmar');
        let cardParaExcluir = null;

        var modalExcluirTitulo = document.getElementById('modal-excluir-titulo');
        var modalExcluirTexto = document.getElementById('modal-excluir-texto');

        function abrirModalExcluir(card) {
            cardParaExcluir = card;
            if (card.classList.contains('mes-tab')) {
                modalExcluirTitulo.textContent = 'Excluir aba do mês';
                modalExcluirTexto.textContent = 'Tem certeza que deseja excluir a aba de ' + formatarNomeMes(card.dataset.mes) + '? Os dados deste mês serão perdidos.';
            } else {
                modalExcluirTitulo.textContent = 'Excluir gasto';
                modalExcluirTexto.textContent = 'Tem certeza que deseja excluir este tipo de gasto?';
            }
            modalExcluir.classList.add('ativo');
            modalExcluir.setAttribute('aria-hidden', 'false');
        }

        function fecharModalExcluir() {
            cardParaExcluir = null;
            modalExcluir.classList.remove('ativo');
            modalExcluir.setAttribute('aria-hidden', 'true');
        }

        function excluirGasto() {
            if (cardParaExcluir) {
                if (cardParaExcluir.classList.contains('mes-tab')) {
                    var chave = cardParaExcluir.dataset.mes;
                    delete state.meses[chave];
                    var restante = Object.keys(state.meses).sort().reverse();
                    if (state.mesAtivo === chave) {
                        state.mesAtivo = restante.length > 0 ? restante[0] : null;
                        state.anoAtivo = state.mesAtivo ? state.mesAtivo.split('-')[0] : (restante.length > 0 ? restante[0].split('-')[0] : state.anoAtivo);
                        if (state.mesAtivo) {
                            restoreState(state.meses[state.mesAtivo]);
                        } else {
                            restoreState(getEmptyMonthData());
                        }
                    }
                    renderYearTabs();
                    renderMonthTabs();
                    atualizarTotais();
                    saveState();
                    fecharModalExcluir();
                    return;
                }
                if (cardParaExcluir === linhaEmEdicao && formEmEdicao) {
                    const btnAdicionar = formEmEdicao.querySelector('.btn-adicionar');
                    const btnCancelarEdicao = formEmEdicao.querySelector('.btn-cancelar-edicao');
                    sairModoEdicao(formEmEdicao, btnAdicionar, btnCancelarEdicao);
                    linhaEmEdicao = null;
                    formEmEdicao = null;
                } else if (formReceitas && cardParaExcluir === linhaEmEdicaoReceita) {
                    sairModoEdicaoReceita(formReceitas.querySelector('.btn-adicionar'), formReceitas.querySelector('.btn-cancelar-edicao'));
                    linhaEmEdicaoReceita = null;
                } else if (formGanhosFuturos && cardParaExcluir === linhaEmEdicaoGanhosFuturos) {
                    sairModoEdicaoGanhosFuturos(formGanhosFuturos.querySelector('.btn-adicionar'), formGanhosFuturos.querySelector('.btn-cancelar-edicao'));
                    linhaEmEdicaoGanhosFuturos = null;
                } else if (cardParaExcluir.tagName === 'TR' && linhaEmEdicaoMensal === cardParaExcluir) {
                    const cardMensal = cardParaExcluir.closest('.card-gasto-mensal');
                    if (cardMensal) sairEdicaoMensal(cardMensal);
                    linhaEmEdicaoMensal = null;
                    cardEmEdicaoMensal = null;
                }
                const cardMensalRef = cardParaExcluir.tagName === 'TR' ? cardParaExcluir.closest('.card-gasto-mensal') : null;
                const eraCardMensal = cardParaExcluir.classList && cardParaExcluir.classList.contains('card-gasto-mensal');
                cardParaExcluir.remove();
                if (cardMensalRef) verificarLimiteCard(cardMensalRef);
                if (eraCardMensal) atualizarSelectMovimentacoes();
                fecharModalExcluir();
                atualizarTotais();
                saveState();
            }
        }

        btnModalCancelar.addEventListener('click', fecharModalExcluir);
        btnModalConfirmar.addEventListener('click', excluirGasto);

        modalExcluir.addEventListener('click', function (e) {
            if (e.target === modalExcluir) {
                fecharModalExcluir();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modalExcluir.classList.contains('ativo')) {
                fecharModalExcluir();
            }
            if (e.key === 'Escape' && modalAvisoDados.classList.contains('ativo')) {
                fecharModalAvisoDados();
            }
        });

        // Modal adicionar mês
        var modalNovoMes = document.getElementById('modal-novo-mes');
        var inputNovoMes = document.getElementById('input-novo-mes');
        var modalNovoMesAviso = document.getElementById('modal-novo-mes-aviso');
        var btnNovoMesCancelar = document.getElementById('modal-novo-mes-cancelar');
        var btnNovoMesConfirmar = document.getElementById('modal-novo-mes-confirmar');

        document.getElementById('btn-adicionar-mes').addEventListener('click', function () {
            var chaves = Object.keys(state.meses).sort().reverse();
            var proximoMes;
            if (chaves.length > 0) {
                var maisAtual = chaves[0];
                var partes = maisAtual.split('-');
                var ano = parseInt(partes[0], 10);
                var mes = parseInt(partes[1], 10);
                if (mes === 12) {
                    ano += 1;
                    mes = 1;
                } else {
                    mes += 1;
                }
                proximoMes = ano + '-' + String(mes).padStart(2, '0');
            } else {
                var hoje = new Date();
                var a = hoje.getFullYear();
                var m = hoje.getMonth() + 1;
                if (m === 12) { a += 1; m = 1; } else { m += 1; }
                proximoMes = a + '-' + String(m).padStart(2, '0');
            }
            inputNovoMes.value = proximoMes;
            modalNovoMesAviso.style.display = 'none';
            modalNovoMes.classList.add('ativo');
            modalNovoMes.setAttribute('aria-hidden', 'false');
            inputNovoMes.focus();
        });

        function fecharModalNovoMes() {
            modalNovoMes.classList.remove('ativo');
            modalNovoMes.setAttribute('aria-hidden', 'true');
        }

        btnNovoMesCancelar.addEventListener('click', fecharModalNovoMes);

        var modalCopiarMesAnterior = document.getElementById('modal-copiar-mes-anterior');
        var modalCopiarTexto = document.getElementById('modal-copiar-mes-anterior-texto');
        var btnCopiarNao = document.getElementById('modal-copiar-nao');
        var btnCopiarSim = document.getElementById('modal-copiar-sim');
        var novoMesPendente = null;
        var mesAnteriorPendente = null;

        function fecharModalCopiarMesAnterior() {
            novoMesPendente = null;
            mesAnteriorPendente = null;
            modalCopiarMesAnterior.classList.remove('ativo');
            modalCopiarMesAnterior.setAttribute('aria-hidden', 'true');
        }

        function criarNovoMesComDados(valor, copiarDoAnterior) {
            state.meses[valor] = copiarDoAnterior && mesAnteriorPendente ? copyMonthDataFrom(mesAnteriorPendente) : getEmptyMonthData();
            state.mesAtivo = valor;
            state.anoAtivo = valor.split('-')[0];
            renderYearTabs();
            renderMonthTabs();
            restoreState(state.meses[valor]);
            atualizarTotais();
            saveState();
        }

        btnNovoMesConfirmar.addEventListener('click', function () {
            var valor = inputNovoMes.value;
            if (!valor) {
                modalNovoMesAviso.textContent = 'Selecione o mês e o ano.';
                modalNovoMesAviso.style.display = 'block';
                return;
            }
            if (state.meses[valor]) {
                modalNovoMesAviso.textContent = 'Este mês já existe.';
                modalNovoMesAviso.style.display = 'block';
                return;
            }
            var prevKey = getPreviousMonthKey(valor);
            if (prevKey && state.meses[prevKey]) {
                novoMesPendente = valor;
                mesAnteriorPendente = prevKey;
                modalCopiarTexto.textContent = 'Deseja que os dados de ' + formatarNomeMes(prevKey) + ' sejam adicionados à nova aba (' + formatarNomeMes(valor) + ')?';
                fecharModalNovoMes();
                modalCopiarMesAnterior.classList.add('ativo');
                modalCopiarMesAnterior.setAttribute('aria-hidden', 'false');
            } else {
                criarNovoMesComDados(valor, false);
                fecharModalNovoMes();
            }
        });

        btnCopiarNao.addEventListener('click', function () {
            if (novoMesPendente) {
                criarNovoMesComDados(novoMesPendente, false);
                fecharModalCopiarMesAnterior();
            }
        });
        btnCopiarSim.addEventListener('click', function () {
            if (novoMesPendente) {
                criarNovoMesComDados(novoMesPendente, true);
                fecharModalCopiarMesAnterior();
            }
        });
        modalCopiarMesAnterior.addEventListener('click', function (e) {
            if (e.target === modalCopiarMesAnterior) {
                if (novoMesPendente) criarNovoMesComDados(novoMesPendente, false);
                fecharModalCopiarMesAnterior();
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modalCopiarMesAnterior.classList.contains('ativo')) {
                if (novoMesPendente) criarNovoMesComDados(novoMesPendente, false);
                fecharModalCopiarMesAnterior();
            }
        });

        modalNovoMes.addEventListener('click', function (e) {
            if (e.target === modalNovoMes) fecharModalNovoMes();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modalNovoMes.classList.contains('ativo')) {
                fecharModalNovoMes();
            }
        });

        // Modal Usuários
        var modalUsuarios = document.getElementById('modal-usuarios');
        var inputNovoUsuario = document.getElementById('input-novo-usuario');
        var listaUsuarios = document.getElementById('lista-usuarios');
        function renderListaUsuarios() {
            if (!listaUsuarios) return;
            listaUsuarios.innerHTML = '';
            (state.usuarios || []).forEach(function (u) {
                var li = document.createElement('li');
                li.innerHTML = '<span class="modal-usuarios-item-nome">' + escapeHtml(u.nome) + '</span><button type="button" class="btn-modal btn-excluir btn-usuarios-remover" data-id="' + escapeHtml(u.id) + '" title="Remover usuário">Excluir</button>';
                li.querySelector('button').addEventListener('click', function () {
                    state.usuarios = state.usuarios.filter(function (x) { return x.id !== u.id; });
                    renderListaUsuarios();
                    applyVisibilityUsuarios();
                    atualizarTotais();
                    saveState();
                });
                listaUsuarios.appendChild(li);
            });
        }
        document.getElementById('btn-usuarios-header').addEventListener('click', function () {
            renderListaUsuarios();
            modalUsuarios.classList.add('ativo');
            modalUsuarios.setAttribute('aria-hidden', 'false');
            inputNovoUsuario.value = '';
            inputNovoUsuario.focus();
        });
        document.getElementById('modal-usuarios-fechar').addEventListener('click', function () {
            modalUsuarios.classList.remove('ativo');
            modalUsuarios.setAttribute('aria-hidden', 'true');
        });
        modalUsuarios.addEventListener('click', function (e) {
            if (e.target === modalUsuarios) {
                modalUsuarios.classList.remove('ativo');
                modalUsuarios.setAttribute('aria-hidden', 'true');
            }
        });
        document.getElementById('btn-adicionar-usuario').addEventListener('click', function () {
            var nome = (inputNovoUsuario.value || '').trim();
            if (!nome) return;
            var id = 'usr-' + Date.now();
            state.usuarios = state.usuarios || [];
            state.usuarios.push({ id: id, nome: nome });
            inputNovoUsuario.value = '';
            renderListaUsuarios();
            applyVisibilityUsuarios();
            atualizarTotais();
            saveState();
        });
        inputNovoUsuario.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btn-adicionar-usuario').click();
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modalUsuarios && modalUsuarios.classList.contains('ativo')) {
                modalUsuarios.classList.remove('ativo');
                modalUsuarios.setAttribute('aria-hidden', 'true');
            }
        });

        // --- Backup de dados ---
        var BACKUP_STORAGE_KEY = 'sorpes-ultimo-backup';

        function getLastBackupDate() {
            try {
                return localStorage.getItem(BACKUP_STORAGE_KEY);
            } catch (e) { return null; }
        }
        function setLastBackupDate() {
            try {
                localStorage.setItem(BACKUP_STORAGE_KEY, new Date().toISOString());
            } catch (e) {}
        }
        function lastBackupWasToday() {
            var iso = getLastBackupDate();
            if (!iso) return false;
            var d = new Date(iso);
            var hoje = new Date();
            return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth() && d.getDate() === hoje.getDate();
        }
        function formatBackupDisplay(iso) {
            if (!iso) return 'nunca';
            var d = new Date(iso);
            var dia = String(d.getDate()).padStart(2, '0');
            var mes = String(d.getMonth() + 1).padStart(2, '0');
            var ano = d.getFullYear();
            var h = String(d.getHours()).padStart(2, '0');
            var min = String(d.getMinutes()).padStart(2, '0');
            return dia + '/' + mes + '/' + ano + ' ' + h + ':' + min;
        }
        function updateBackupButtonText() {
            var el = document.getElementById('backup-ultima-data');
            var txt = formatBackupDisplay(getLastBackupDate());
            if (el) el.textContent = txt;
            var btn = document.getElementById('btn-backup-header');
            if (btn) btn.setAttribute('title', 'Backup dos dados - último: ' + txt);
        }
        function exportBackup() {
            if (state.mesAtivo) state.meses[state.mesAtivo] = getStateFromDOM();
            var json = JSON.stringify(state);
            var blob = new Blob([json], { type: 'application/json' });
            var now = new Date();
            var nome = 'sorpes-backup-' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + '.json';
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = nome;
            a.click();
            URL.revokeObjectURL(a.href);
            setLastBackupDate();
            updateBackupButtonText();
        }
        function importBackup(file, onSuccess, onError) {
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var data = JSON.parse(reader.result);
                    if (!data || typeof data.meses !== 'object') {
                        if (onError) onError('Arquivo inválido.');
                        return;
                    }
                    state.meses = data.meses || {};
                    state.usuarios = Array.isArray(data.usuarios) ? data.usuarios : (state.usuarios || []);
                    state.mesAtivo = data.mesAtivo || (Object.keys(state.meses).sort().reverse()[0] || null);
                    state.anoAtivo = data.anoAtivo || (state.mesAtivo ? state.mesAtivo.split('-')[0] : '2026');
                    if (!state.mesAtivo && Object.keys(state.meses).length > 0) {
                        state.mesAtivo = Object.keys(state.meses).sort().reverse()[0];
                        state.anoAtivo = state.mesAtivo.split('-')[0];
                    }
                    if (!state.mesAtivo) {
                        state.mesAtivo = '2026-02';
                        state.anoAtivo = '2026';
                        if (!state.meses['2026-02']) state.meses['2026-02'] = getEmptyMonthData();
                    }
                    renderYearTabs();
                    renderMonthTabs();
                    restoreState(state.meses[state.mesAtivo] || getEmptyMonthData());
                    if (typeof applyVisibilityUsuarios === 'function') applyVisibilityUsuarios();
                    atualizarTotais();
                    saveToDB(state);
                    if (onSuccess) onSuccess();
                } catch (err) {
                    if (onError) onError('Erro ao ler o arquivo.');
                }
            };
            reader.onerror = function () { if (onError) onError('Erro ao ler o arquivo.'); };
            reader.readAsText(file);
        }

        function clearAllData() {
            state.meses = {};
            state.meses['2026-02'] = getEmptyMonthData();
            state.mesAtivo = '2026-02';
            state.anoAtivo = '2026';
            try { localStorage.removeItem(BACKUP_STORAGE_KEY); } catch (err) {}
            saveToDB(state);
            renderYearTabs();
            renderMonthTabs();
            restoreState(state.meses[state.mesAtivo]);
            atualizarTotais();
            updateBackupButtonText();
        }

        var overlayBackupInicial = document.getElementById('overlay-backup-inicial');
        var backupInicialTexto = document.getElementById('backup-inicial-texto');
        var btnBackupInicialPular = document.getElementById('backup-inicial-pular');
        var btnBackupInicialFazer = document.getElementById('backup-inicial-fazer');
        var modalBackupMenu = document.getElementById('modal-backup-menu');
        var btnBackupHeader = document.getElementById('btn-backup-header');
        var btnBackupManual = document.getElementById('backup-manual');
        var btnBackupCarregar = document.getElementById('backup-carregar');
        var inputBackupFile = document.getElementById('input-backup-file');
        var btnBackupMenuFechar = document.getElementById('backup-menu-fechar');
        var btnBackupExcluirTudo = document.getElementById('backup-excluir-tudo');
        if (btnBackupExcluirTudo) {
            btnBackupExcluirTudo.addEventListener('click', function () {
                if (!confirm('Tem certeza que deseja excluir TODOS os dados do sistema? Gastos, receitas e movimentações de todos os meses serão apagados. Esta ação não pode ser desfeita.')) return;
                clearAllData();
                modalBackupMenu.classList.remove('ativo');
                modalBackupMenu.setAttribute('aria-hidden', 'true');
            });
        }

        btnBackupInicialPular.addEventListener('click', function () {
            overlayBackupInicial.classList.remove('ativo');
            overlayBackupInicial.setAttribute('aria-hidden', 'true');
        });
        btnBackupInicialFazer.addEventListener('click', function () {
            exportBackup();
            overlayBackupInicial.classList.remove('ativo');
            overlayBackupInicial.setAttribute('aria-hidden', 'true');
        });

        btnBackupHeader.addEventListener('click', function () {
            modalBackupMenu.classList.add('ativo');
            modalBackupMenu.setAttribute('aria-hidden', 'false');
        });

        var cabecalhoTotais = document.getElementById('cabecalho-totais');
        var btnVerMaisCards = document.getElementById('btn-ver-mais-cards');
        if (btnVerMaisCards && cabecalhoTotais) {
            btnVerMaisCards.addEventListener('click', function () {
                var expandido = cabecalhoTotais.classList.toggle('totais-expandido');
                btnVerMaisCards.setAttribute('title', expandido ? 'Ocultar os demais cards' : 'Exibir todos os cards de totais');
                btnVerMaisCards.setAttribute('aria-label', expandido ? 'Ocultar todos os cards' : 'Exibir todos os cards');
            });
        }

        var btnEstatistica = document.getElementById('btn-estatistica');
        var modalEstatisticas = document.getElementById('modal-estatisticas');
        var btnEstatisticasFechar = document.getElementById('btn-estatisticas-fechar');
        var modalEstatisticasBody = document.getElementById('modal-estatisticas-body');

        function abrirModalEstatisticas() {
            if (state.mesAtivo) state.meses[state.mesAtivo] = getStateFromDOM();
            var stats = calcularEstatisticas();
            renderEstatisticas(stats);
            modalEstatisticas.classList.add('ativo');
            modalEstatisticas.setAttribute('aria-hidden', 'false');
        }
        function fecharModalEstatisticas() {
            modalEstatisticas.classList.remove('ativo');
            modalEstatisticas.setAttribute('aria-hidden', 'true');
        }

        function calcularEstatisticas() {
            var meses = state.meses || {};
            var chaves = Object.keys(meses).sort();
            var totalFixos = 0, totalVariaveis = 0, totalMensais = 0, totalReceitas = 0, totalGanhosFuturos = 0;
            var porTipoFixos = {}, porTipoVariaveis = {}, porTipoReceitas = {}, porTipoGanhosFuturos = {};
            var porMes = {};
            var topGastos = [];
            var blocosMensais = {};
            var fixosPagos = 0, fixosNaoPagos = 0, variaveisPagos = 0, variaveisNaoPagos = 0;

            chaves.forEach(function (chave) {
                var d = meses[chave] || {};
                var fixos = d.gastosFixos || [];
                var variaveis = d.gastosVariaveis || [];
                var mensais = d.gastosMensais || [];
                var receitas = d.receitas || [];
                var ganhosFut = d.ganhosFuturos || [];

                var sFixos = 0, sVar = 0, sMensais = 0, sRec = 0, sGF = 0;
                fixos.forEach(function (g) {
                    var v = parseFloat(g.valor) || 0;
                    sFixos += v;
                    totalFixos += v;
                    var tipo = (g.tipo || 'Sem tipo').trim() || 'Sem tipo';
                    porTipoFixos[tipo] = (porTipoFixos[tipo] || 0) + v;
                    topGastos.push({ desc: g.descricao, tipo: 'Fixos', valor: v, mes: chave });
                    if (g.pago) fixosPagos += v; else fixosNaoPagos += v;
                });
                variaveis.forEach(function (g) {
                    var v = parseFloat(g.valor) || 0;
                    sVar += v;
                    totalVariaveis += v;
                    var tipo = (g.tipo || 'Sem tipo').trim() || 'Sem tipo';
                    porTipoVariaveis[tipo] = (porTipoVariaveis[tipo] || 0) + v;
                    topGastos.push({ desc: g.descricao, tipo: 'Variáveis', valor: v, mes: chave });
                    if (g.pago) variaveisPagos += v; else variaveisNaoPagos += v;
                });
                mensais.forEach(function (c) {
                    var limite = parseFloat(c.limite) || 0;
                    var gasto = 0;
                    (c.items || []).forEach(function (item) {
                        var v = parseFloat(item.valor) || 0;
                        gasto += v;
                        totalMensais += v;
                        sMensais += v;
                        topGastos.push({ desc: (c.titulo || '') + (item.descricao ? ' - ' + item.descricao : ''), tipo: 'Mensais', valor: v, mes: chave });
                    });
                    blocosMensais[c.titulo || 'Sem título'] = (blocosMensais[c.titulo || 'Sem título'] || { gasto: 0, limite: 0 });
                    blocosMensais[c.titulo || 'Sem título'].gasto += gasto;
                    blocosMensais[c.titulo || 'Sem título'].limite += limite;
                });
                receitas.forEach(function (r) {
                    var v = parseFloat(r.valor) || 0;
                    sRec += v;
                    totalReceitas += v;
                    var tipo = (r.tipo || 'Sem tipo').trim() || 'Sem tipo';
                    porTipoReceitas[tipo] = (porTipoReceitas[tipo] || 0) + v;
                });
                ganhosFut.forEach(function (g) {
                    var v = parseFloat(g.valor) || 0;
                    sGF += v;
                    totalGanhosFuturos += v;
                    var tipo = (g.tipo || 'Sem tipo').trim() || 'Sem tipo';
                    porTipoGanhosFuturos[tipo] = (porTipoGanhosFuturos[tipo] || 0) + v;
                });

                porMes[chave] = {
                    fixos: sFixos, variaveis: sVar, mensais: sMensais, receitas: sRec, ganhosFuturos: sGF,
                    gastoTotal: sFixos + sVar + sMensais,
                    saldo: sRec - (sFixos + sVar + sMensais)
                };
            });

            topGastos.sort(function (a, b) { return b.valor - a.valor; });

            var gastoTotalGeral = totalFixos + totalVariaveis + totalMensais;
            return {
                totalFixos: totalFixos,
                totalVariaveis: totalVariaveis,
                totalMensais: totalMensais,
                totalReceitas: totalReceitas,
                totalGanhosFuturos: totalGanhosFuturos,
                gastoTotalGeral: gastoTotalGeral,
                saldoGeral: totalReceitas - gastoTotalGeral,
                projecaoSaldo: (totalReceitas + totalGanhosFuturos) - gastoTotalGeral,
                porTipoFixos: porTipoFixos,
                porTipoVariaveis: porTipoVariaveis,
                porTipoReceitas: porTipoReceitas,
                porTipoGanhosFuturos: porTipoGanhosFuturos,
                porMes: porMes,
                topGastos: topGastos.slice(0, 15),
                blocosMensais: blocosMensais,
                fixosPagos: fixosPagos, fixosNaoPagos: fixosNaoPagos,
                variaveisPagos: variaveisPagos, variaveisNaoPagos: variaveisNaoPagos,
                mesesComDados: chaves.length
            };
        }

        function renderEstatisticas(stats) {
            if (!modalEstatisticasBody) return;
            var html = '';

            if (stats.mesesComDados === 0) {
                html = '<div class="estat-vazio">Nenhum dado cadastrado ainda. Adicione gastos, receitas e ganhos para visualizar as estatísticas.</div>';
            } else {
                var maxBar = Math.max(stats.gastoTotalGeral, stats.totalReceitas, 1);
                var cores = ['#059669', '#d97706', '#2563eb', '#dc2626', '#10b981', '#8b5cf6'];

                html += '<div class="estat-card"><div class="estat-card-titulo">Resumo geral (todos os meses)</div>';
                html += '<div class="estat-grid">';
                html += '<div class="estat-numero"><div class="estat-numero-label">Gastos Fixos</div><div class="estat-numero-valor">R$ ' + formatarValor(stats.totalFixos) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Gastos Variáveis</div><div class="estat-numero-valor">R$ ' + formatarValor(stats.totalVariaveis) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Movimentações Diversas</div><div class="estat-numero-valor">R$ ' + formatarValor(stats.totalMensais) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Total Gastos</div><div class="estat-numero-valor">R$ ' + formatarValor(stats.gastoTotalGeral) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Receitas</div><div class="estat-numero-valor positivo">R$ ' + formatarValor(stats.totalReceitas) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Ganhos Futuros</div><div class="estat-numero-valor">R$ ' + formatarValor(stats.totalGanhosFuturos) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Saldo (Receitas - Gastos)</div><div class="estat-numero-valor ' + (stats.saldoGeral >= 0 ? 'positivo' : 'negativo') + '">R$ ' + formatarValor(stats.saldoGeral) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Projeção (com ganhos futuros)</div><div class="estat-numero-valor ' + (stats.projecaoSaldo >= 0 ? 'positivo' : 'negativo') + '">R$ ' + formatarValor(stats.projecaoSaldo) + '</div></div>';
                html += '</div></div>';

                html += '<div class="estat-card"><div class="estat-card-titulo">Distribuição dos gastos por categoria</div><div class="estat-barras-horizontal">';
                var partes = [
                    { nome: 'Fixos', valor: stats.totalFixos, cor: cores[0] },
                    { nome: 'Variáveis', valor: stats.totalVariaveis, cor: cores[1] },
                    { nome: 'Mensais', valor: stats.totalMensais, cor: cores[2] }
                ].filter(function (p) { return p.valor > 0; });
                partes.forEach(function (p, i) {
                    var pct = maxBar > 0 ? (p.valor / maxBar * 100) : 0;
                    html += '<div class="estat-barra-item"><span class="estat-barra-item-nome">' + escapeHtml(p.nome) + '</span><div class="estat-barra-item-bar"><div class="estat-barra-item-fill animar" style="width:' + pct + '%;background:' + p.cor + '"></div></div><span class="estat-barra-item-valor">R$ ' + formatarValor(p.valor) + '</span></div>';
                });
                html += '</div></div>';

                var tiposFixos = Object.keys(stats.porTipoFixos).filter(function (k) { return stats.porTipoFixos[k] > 0; });
                if (tiposFixos.length > 0) {
                    html += '<div class="estat-card"><div class="estat-card-titulo">Gastos Fixos por tipo</div><div class="estat-barras-horizontal">';
                    tiposFixos.sort(function (a, b) { return stats.porTipoFixos[b] - stats.porTipoFixos[a]; }).slice(0, 10).forEach(function (tipo, i) {
                        var v = stats.porTipoFixos[tipo];
                        var pct = stats.totalFixos > 0 ? (v / stats.totalFixos * 100) : 0;
                        html += '<div class="estat-barra-item"><span class="estat-barra-item-nome">' + escapeHtml(tipo) + '</span><div class="estat-barra-item-bar"><div class="estat-barra-item-fill animar" style="width:' + pct + '%;background:' + cores[i % cores.length] + '"></div></div><span class="estat-barra-item-valor">R$ ' + formatarValor(v) + '</span></div>';
                    });
                    html += '</div></div>';
                }

                var tiposVar = Object.keys(stats.porTipoVariaveis).filter(function (k) { return stats.porTipoVariaveis[k] > 0; });
                if (tiposVar.length > 0) {
                    html += '<div class="estat-card"><div class="estat-card-titulo">Gastos Variáveis por tipo</div><div class="estat-barras-horizontal">';
                    tiposVar.sort(function (a, b) { return stats.porTipoVariaveis[b] - stats.porTipoVariaveis[a]; }).slice(0, 10).forEach(function (tipo, i) {
                        var v = stats.porTipoVariaveis[tipo];
                        var pct = stats.totalVariaveis > 0 ? (v / stats.totalVariaveis * 100) : 0;
                        html += '<div class="estat-barra-item"><span class="estat-barra-item-nome">' + escapeHtml(tipo) + '</span><div class="estat-barra-item-bar"><div class="estat-barra-item-fill animar" style="width:' + pct + '%;background:' + cores[i % cores.length] + '"></div></div><span class="estat-barra-item-valor">R$ ' + formatarValor(v) + '</span></div>';
                    });
                    html += '</div></div>';
                }

                var blocos = Object.keys(stats.blocosMensais).filter(function (k) { return stats.blocosMensais[k].gasto > 0 || stats.blocosMensais[k].limite > 0; });
                if (blocos.length > 0) {
                    html += '<div class="estat-card"><div class="estat-card-titulo">Movimentações Diversas por bloco</div><table class="estat-tabela"><thead><tr><th>Bloco</th><th>Gasto</th><th>Limite</th><th>Saldo</th></tr></thead><tbody>';
                    blocos.forEach(function (titulo) {
                        var b = stats.blocosMensais[titulo];
                        var saldo = b.limite - b.gasto;
                        html += '<tr><td>' + escapeHtml(titulo) + '</td><td>R$ ' + formatarValor(b.gasto) + '</td><td>R$ ' + formatarValor(b.limite) + '</td><td class="' + (saldo >= 0 ? 'positivo' : 'negativo') + '">R$ ' + formatarValor(saldo) + '</td></tr>';
                    });
                    html += '</tbody></table></div>';
                }

                var tiposRec = Object.keys(stats.porTipoReceitas).filter(function (k) { return stats.porTipoReceitas[k] > 0; });
                if (tiposRec.length > 0) {
                    html += '<div class="estat-card"><div class="estat-card-titulo">Receitas por tipo</div><div class="estat-barras-horizontal">';
                    tiposRec.sort(function (a, b) { return stats.porTipoReceitas[b] - stats.porTipoReceitas[a]; }).slice(0, 10).forEach(function (tipo, i) {
                        var v = stats.porTipoReceitas[tipo];
                        var pct = stats.totalReceitas > 0 ? (v / stats.totalReceitas * 100) : 0;
                        html += '<div class="estat-barra-item"><span class="estat-barra-item-nome">' + escapeHtml(tipo) + '</span><div class="estat-barra-item-bar"><div class="estat-barra-item-fill animar" style="width:' + pct + '%;background:#10b981"></div></div><span class="estat-barra-item-valor">R$ ' + formatarValor(v) + '</span></div>';
                    });
                    html += '</div></div>';
                }

                html += '<div class="estat-card"><div class="estat-card-titulo">Gastos Fixos e Variáveis: Pagos vs Pendentes</div><div class="estat-grid">';
                html += '<div class="estat-numero"><div class="estat-numero-label">Fixos Pagos</div><div class="estat-numero-valor positivo">R$ ' + formatarValor(stats.fixosPagos) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Fixos Pendentes</div><div class="estat-numero-valor">R$ ' + formatarValor(stats.fixosNaoPagos) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Variáveis Pagos</div><div class="estat-numero-valor positivo">R$ ' + formatarValor(stats.variaveisPagos) + '</div></div>';
                html += '<div class="estat-numero"><div class="estat-numero-label">Variáveis Pendentes</div><div class="estat-numero-valor">R$ ' + formatarValor(stats.variaveisNaoPagos) + '</div></div>';
                html += '</div></div>';

                if (stats.topGastos.length > 0) {
                    html += '<div class="estat-card"><div class="estat-card-titulo">Top 15 maiores gastos</div><table class="estat-tabela"><thead><tr><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Mês</th></tr></thead><tbody>';
                    stats.topGastos.forEach(function (g) {
                        html += '<tr><td>' + escapeHtml(g.desc || '-') + '</td><td>' + escapeHtml(g.tipo) + '</td><td>R$ ' + formatarValor(g.valor) + '</td><td>' + formatarNomeMes(g.mes) + '</td></tr>';
                    });
                    html += '</tbody></table></div>';
                }

                var chavesMes = Object.keys(stats.porMes).sort().reverse().slice(0, 12);
                if (chavesMes.length > 0) {
                    html += '<div class="estat-card"><div class="estat-card-titulo">Evolução por mês (últimos 12)</div><table class="estat-tabela"><thead><tr><th>Mês</th><th>Receitas</th><th>Gastos</th><th>Saldo</th></tr></thead><tbody>';
                    chavesMes.forEach(function (chave) {
                        var m = stats.porMes[chave];
                        html += '<tr><td>' + formatarNomeMes(chave) + '</td><td>R$ ' + formatarValor(m.receitas) + '</td><td>R$ ' + formatarValor(m.gastoTotal) + '</td><td class="' + (m.saldo >= 0 ? 'positivo' : 'negativo') + '">R$ ' + formatarValor(m.saldo) + '</td></tr>';
                    });
                    html += '</tbody></table></div>';
                }

                var tiposGF = Object.keys(stats.porTipoGanhosFuturos).filter(function (k) { return stats.porTipoGanhosFuturos[k] > 0; });
                if (tiposGF.length > 0) {
                    html += '<div class="estat-card"><div class="estat-card-titulo">Ganhos futuros por tipo</div><div class="estat-barras-horizontal">';
                    tiposGF.sort(function (a, b) { return stats.porTipoGanhosFuturos[b] - stats.porTipoGanhosFuturos[a]; }).slice(0, 10).forEach(function (tipo, i) {
                        var v = stats.porTipoGanhosFuturos[tipo];
                        var pct = stats.totalGanhosFuturos > 0 ? (v / stats.totalGanhosFuturos * 100) : 0;
                        html += '<div class="estat-barra-item"><span class="estat-barra-item-nome">' + escapeHtml(tipo) + '</span><div class="estat-barra-item-bar"><div class="estat-barra-item-fill animar" style="width:' + pct + '%;background:#8b5cf6"></div></div><span class="estat-barra-item-valor">R$ ' + formatarValor(v) + '</span></div>';
                    });
                    html += '</div></div>';
                }
            }

            modalEstatisticasBody.innerHTML = html;

            setTimeout(function () {
                modalEstatisticasBody.querySelectorAll('.estat-barra-item-fill').forEach(function (el) {
                    var w = el.style.width || '0';
                    el.style.width = '0';
                    el.offsetHeight;
                    el.style.width = w;
                });
            }, 80);
        }

        if (btnEstatistica) btnEstatistica.addEventListener('click', abrirModalEstatisticas);
        if (btnEstatisticasFechar) btnEstatisticasFechar.addEventListener('click', fecharModalEstatisticas);
        if (modalEstatisticas) {
            modalEstatisticas.addEventListener('click', function (e) {
                if (e.target === modalEstatisticas) fecharModalEstatisticas();
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modalEstatisticas && modalEstatisticas.classList.contains('ativo')) fecharModalEstatisticas();
        });

        btnBackupManual.addEventListener('click', function () {
            exportBackup();
            modalBackupMenu.classList.remove('ativo');
            modalBackupMenu.setAttribute('aria-hidden', 'true');
        });
        btnBackupCarregar.addEventListener('click', function () {
            inputBackupFile.value = '';
            inputBackupFile.click();
        });
        inputBackupFile.addEventListener('change', function () {
            var file = this.files[0];
            if (!file) return;
            importBackup(file, function () {
                modalBackupMenu.classList.remove('ativo');
                modalBackupMenu.setAttribute('aria-hidden', 'true');
                alert('Backup restaurado com sucesso.');
            }, function (msg) {
                alert(msg || 'Erro ao carregar o backup.');
            });
        });
        btnBackupMenuFechar.addEventListener('click', function () {
            modalBackupMenu.classList.remove('ativo');
            modalBackupMenu.setAttribute('aria-hidden', 'true');
        });
        modalBackupMenu.addEventListener('click', function (e) {
            if (e.target === modalBackupMenu) {
                modalBackupMenu.classList.remove('ativo');
                modalBackupMenu.setAttribute('aria-hidden', 'true');
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && modalBackupMenu.classList.contains('ativo')) {
                modalBackupMenu.classList.remove('ativo');
                modalBackupMenu.setAttribute('aria-hidden', 'true');
            }
        });

        var firebaseLoad = (window.sorpesFirebase && typeof window.sorpesFirebase.carregarEstado === 'function')
            ? window.sorpesFirebase.carregarEstado() : Promise.resolve(null);
        Promise.all([loadFromDB(), firebaseLoad]).then(function (results) {
            var loaded = results[0];
            var firebaseData = results[1];
            var stateToUse = (firebaseData && (firebaseData.meses && Object.keys(firebaseData.meses).length > 0 || firebaseData.gastosFixos || firebaseData.receitas || firebaseData.gastosMensais))
                ? firebaseData : loaded;
            if (stateToUse && Array.isArray(stateToUse.usuarios)) state.usuarios = stateToUse.usuarios;
            if (stateToUse && stateToUse.meses && Object.keys(stateToUse.meses).length > 0) {
                state.meses = stateToUse.meses;
                state.mesAtivo = stateToUse.mesAtivo || '2026-02';
                if (!state.meses[state.mesAtivo]) {
                    state.mesAtivo = Object.keys(state.meses).sort().reverse()[0];
                }
                state.anoAtivo = stateToUse.anoAtivo || (state.mesAtivo ? state.mesAtivo.split('-')[0] : '2026');
            } else if (stateToUse && (stateToUse.gastosFixos || stateToUse.receitas || stateToUse.gastosMensais)) {
                state.meses['2026-02'] = stateToUse;
                state.mesAtivo = '2026-02';
                state.anoAtivo = '2026';
            } else {
                state.meses['2026-02'] = getEmptyMonthData();
                state.mesAtivo = '2026-02';
                state.anoAtivo = '2026';
            }
            if (firebaseData === stateToUse) saveToDB(state);
            renderYearTabs();
            renderMonthTabs();
            restoreState(state.meses[state.mesAtivo] || getEmptyMonthData());
            if (typeof applyVisibilityUsuarios === 'function') applyVisibilityUsuarios();
            atualizarTotais();
            updateBackupButtonText();
            if (!lastBackupWasToday()) {
                var ultimo = getLastBackupDate();
                backupInicialTexto.textContent = ultimo
                    ? 'Recomendamos fazer backup dos seus dados antes de continuar. Último backup: ' + formatBackupDisplay(ultimo) + '.'
                    : 'Recomendamos fazer backup dos seus dados antes de continuar.';
                overlayBackupInicial.classList.add('ativo');
                overlayBackupInicial.setAttribute('aria-hidden', 'false');
            }
        });
    });
})();
