/**
 * SORPES Cell - Controle Financeiro (versão mobile)
 * Script principal - Persistência em IndexedDB (banco separado do desktop)
 */

(function () {
    'use strict';

    const DB_NAME = 'sorpes-cell-db';
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
                tx.oncomplete = function () { db.close(); resolve(); };
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
        var state = { meses: {}, mesAtivo: '2026-02', anoAtivo: '2026' };

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
                return { vencimento: g.vencimento, descricao: g.descricao, tipo: g.tipo, valor: g.valor, pago: false };
            });
            var variaveis = (ant.gastosVariaveis || []).map(function (g) {
                return { vencimento: g.vencimento, descricao: g.descricao, tipo: g.tipo, valor: g.valor, pago: false };
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
            });
        });

        const formularios = document.querySelectorAll('.formulario-gasto');

        let linhaEmEdicao = null;
        let formEmEdicao = null;
        let linhaEmEdicaoReceita = null;

        formularios.forEach(function (form) {
            const btnAdicionar = form.querySelector('.btn-adicionar');
            const btnCancelarEdicao = form.querySelector('.btn-cancelar-edicao');

            form.addEventListener('submit', function (e) {
                e.preventDefault();

                const vencimento = form.querySelector('[name="vencimento"]').value;
                const descricao = form.querySelector('[name="descricao"]').value;
                const tipoInput = form.querySelector('[name="tipo"]');
                const tipo = tipoInput ? tipoInput.value : '';
                const valor = parseFloat(form.querySelector('[name="valor"]').value);
                const pago = linhaEmEdicao ? linhaEmEdicao.dataset.pago === 'true' : false;

                const tabelaId = form.dataset.tipo === 'fixo' ? 'tabela-gastos-fixos' : 'tabela-gastos-variaveis';
                const tbody = document.querySelector('#' + tabelaId + ' tbody');

                if (linhaEmEdicao) {
                    atualizarLinha(linhaEmEdicao, vencimento, descricao, tipo, valor, pago);
                    sairModoEdicao(form, btnAdicionar, btnCancelarEdicao);
                    linhaEmEdicao = null;
                    formEmEdicao = null;
                    atualizarTotais();
                } else {
                    const tr = criarLinhaTabela(vencimento, descricao, tipo, valor, false);
                    tbody.appendChild(tr);
                    vincularEventosLinha(tr, form, tabelaId, btnAdicionar, btnCancelarEdicao);
                }
                ordenarTabelaPorVencimento(tbody);
                form.reset();
                atualizarTotais();
                saveState();
            });

            btnCancelarEdicao.addEventListener('click', function () {
                sairModoEdicao(form, btnAdicionar, btnCancelarEdicao);
                linhaEmEdicao = null;
                formEmEdicao = null;
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

        function criarLinhaTabela(vencimento, descricao, tipo, valor, pago) {
            const tr = document.createElement('tr');
            tr.dataset.vencimento = vencimento;
            tr.dataset.descricao = descricao;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.dataset.pago = pago ? 'true' : 'false';

            const checked = pago ? ' checked' : '';
            tr.innerHTML =
                '<td>' + formatarData(vencimento) + '</td>' +
                '<td>' + escapeHtml(descricao) + '</td>' +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
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

        function atualizarLinha(tr, vencimento, descricao, tipo, valor, pago) {
            tr.dataset.vencimento = vencimento;
            tr.dataset.descricao = descricao;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.dataset.pago = pago ? 'true' : 'false';
            tr.cells[0].textContent = formatarData(vencimento);
            tr.cells[1].textContent = descricao;
            tr.cells[2].className = 'valor-real';
            tr.cells[2].textContent = 'R$ ' + formatarValor(valor);
            tr.cells[3].innerHTML = '<input type="checkbox" class="check-pago" ' + (pago ? ' checked' : '') + ' title="Marcar como pago">';
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
            var tipoEl = form.querySelector('[name="tipo"]');
            if (tipoEl) tipoEl.value = tr.dataset.tipo || '';
            form.querySelector('[name="valor"]').value = tr.dataset.valor;
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

                if (!data || !tipo || isNaN(valor) || valor < 0) return;

                const tbody = document.querySelector('#tabela-receitas tbody');

                if (linhaEmEdicaoReceita) {
                    atualizarLinhaReceita(linhaEmEdicaoReceita, data, tipo, valor);
                    sairModoEdicaoReceita(btnAdicionarReceita, btnCancelarReceita);
                    linhaEmEdicaoReceita = null;
                    atualizarTotais();
                } else {
                    const tr = criarLinhaReceita(data, tipo, valor);
                    tbody.appendChild(tr);
                    vincularEventosLinhaReceita(tr, btnAdicionarReceita, btnCancelarReceita);
                }
                formReceitas.reset();
                atualizarTotais();
                saveState();
            });

            btnCancelarReceita.addEventListener('click', function () {
                sairModoEdicaoReceita(btnAdicionarReceita, btnCancelarReceita);
                linhaEmEdicaoReceita = null;
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

                if (!data || !tipo || isNaN(valor) || valor < 0) return;

                const tbody = document.querySelector('#tabela-ganhos-futuros tbody');

                if (linhaEmEdicaoGanhosFuturos) {
                    atualizarLinhaGanhosFuturos(linhaEmEdicaoGanhosFuturos, data, tipo, valor);
                    sairModoEdicaoGanhosFuturos(btnAdicionarGF, btnCancelarGF);
                    linhaEmEdicaoGanhosFuturos = null;
                    atualizarTotais();
                } else {
                    const tr = criarLinhaGanhosFuturos(data, tipo, valor);
                    tbody.appendChild(tr);
                    vincularEventosLinhaGanhosFuturos(tr, btnAdicionarGF, btnCancelarGF);
                }
                formGanhosFuturos.reset();
                atualizarTotais();
                saveState();
            });

            btnCancelarGF.addEventListener('click', function () {
                sairModoEdicaoGanhosFuturos(btnAdicionarGF, btnCancelarGF);
                linhaEmEdicaoGanhosFuturos = null;
            });
        }

        function criarLinhaGanhosFuturos(data, tipo, valor) {
            const tr = document.createElement('tr');
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.innerHTML =
                '<td>' + formatarData(data) + '</td>' +
                '<td>' + escapeHtml(tipo) + '</td>' +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
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

        function atualizarLinhaGanhosFuturos(tr, data, tipo, valor) {
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.cells[0].textContent = formatarData(data);
            tr.cells[1].textContent = tipo;
            tr.cells[2].className = 'valor-real';
            tr.cells[2].textContent = 'R$ ' + formatarValor(valor);
        }

        function vincularEventosLinhaGanhosFuturos(tr, btnAdicionarGF, btnCancelarGF) {
            tr.querySelector('.btn-editar').addEventListener('click', function () {
                if (linhaEmEdicaoGanhosFuturos) return;
                formGanhosFuturos.querySelector('[name="data"]').value = tr.dataset.data;
                formGanhosFuturos.querySelector('[name="tipo"]').value = tr.dataset.tipo;
                formGanhosFuturos.querySelector('[name="valor"]').value = tr.dataset.valor;
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

        function criarLinhaReceita(data, tipo, valor) {
            const tr = document.createElement('tr');
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.innerHTML =
                '<td>' + formatarData(data) + '</td>' +
                '<td>' + escapeHtml(tipo) + '</td>' +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
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

        function atualizarLinhaReceita(tr, data, tipo, valor) {
            tr.dataset.data = data;
            tr.dataset.tipo = tipo;
            tr.dataset.valor = valor;
            tr.cells[0].textContent = formatarData(data);
            tr.cells[1].textContent = tipo;
            tr.cells[2].className = 'valor-real';
            tr.cells[2].textContent = 'R$ ' + formatarValor(valor);
        }

        function vincularEventosLinhaReceita(tr, btnAdicionarReceita, btnCancelarReceita) {
            tr.querySelector('.btn-editar').addEventListener('click', function () {
                if (linhaEmEdicaoReceita) return;
                formReceitas.querySelector('[name="data"]').value = tr.dataset.data;
                formReceitas.querySelector('[name="tipo"]').value = tr.dataset.tipo;
                formReceitas.querySelector('[name="valor"]').value = tr.dataset.valor;
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

        // Gastos Mensais - botão que cria novos campos
        let linhaEmEdicaoMensal = null;
        let cardEmEdicaoMensal = null;
        const btnAdicionarGastoMensal = document.getElementById('btn-adicionar-gasto-mensal');
        const listaGastosMensais = document.getElementById('lista-gastos-mensais');

        function criarCardGastoMensal(dados) {
            const id = dados && dados.id ? dados.id : 'gasto-mensal-' + Date.now();
            const card = document.createElement('div');
            card.className = 'card-gasto-mensal';
            card.dataset.id = id;
            card.innerHTML =
                '<div class="card-gasto-mensal-cabecalho">' +
                '  <div class="titulo-bloco" contenteditable="true" data-placeholder="Nome do bloco"></div>' +
                '  <button type="button" class="btn-excluir-gasto" aria-label="Excluir este gasto">×</button>' +
                '</div>' +
                '<div class="card-gasto-mensal-limite">' +
                '  <label>Limite de gasto</label>' +
                '  <div class="limite-linha">' +
                '    <div class="input-limite-wrapper">' +
                '      <span class="prefixo-moeda">R$</span>' +
                '      <input type="text" class="input-limite" placeholder="0,00" inputmode="decimal" title="Valor limite para este bloco">' +
                '    </div>' +
                '    <span class="disponivel-gasto" title="Valor que ainda pode ser gasto neste bloco"></span>' +
                '  </div>' +
                '</div>' +
                '<div class="card-gasto-mensal-form">' +
                '  <div class="campo">' +
                '    <label>Data do gasto</label>' +
                '    <input type="date" name="data" required>' +
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
                '  <thead><tr><th>Data</th><th>Valor</th><th>Ações</th></tr></thead>' +
                '  <tbody></tbody>' +
                '</table>';
            listaGastosMensais.appendChild(card);

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
                const comDescricao = dados.titulo && dados.titulo.trim().toLowerCase() === 'outros';
                if (dados.items && dados.items.length) {
                    dados.items.forEach(function (item) {
                        const descricao = comDescricao ? (item.descricao || '') : undefined;
                        const tr = criarLinhaGastoMensal(item.data, item.valor, descricao);
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
                const descricao = ehCardOutros(card) && descricaoInput ? descricaoInput.value.trim() : undefined;

                if (!data || isNaN(valor) || valor < 0) return;

                const tbody = card.querySelector('.tabela-gasto-mensal tbody');
                const colValorIdx = ehCardOutros(card) ? 2 : 1;
                const colDescIdx = 1;

                if (linhaEmEdicaoMensal && cardEmEdicaoMensal === card) {
                    linhaEmEdicaoMensal.dataset.data = data;
                    linhaEmEdicaoMensal.dataset.valor = valor;
                    if (ehCardOutros(card)) {
                        linhaEmEdicaoMensal.dataset.descricao = descricao || '';
                        linhaEmEdicaoMensal.cells[colDescIdx].textContent = descricao || '';
                    }
                    linhaEmEdicaoMensal.cells[0].textContent = formatarData(data);
                    linhaEmEdicaoMensal.cells[colValorIdx].textContent = 'R$ ' + formatarValor(valor);
                    linhaEmEdicaoMensal.cells[colValorIdx].className = 'valor-real';
                    sairEdicaoMensal(card);
                    linhaEmEdicaoMensal = null;
                    cardEmEdicaoMensal = null;
                } else {
                    const tr = criarLinhaGastoMensal(data, valor, descricao);
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
            });
            aplicarEstruturaOutros(card);
            verificarLimiteCard(card);
            return card;
        }

        btnAdicionarGastoMensal.addEventListener('click', function () {
            criarCardGastoMensal(null);
            saveState();
        });

        function ehCardOutros(card) {
            const titulo = (card.querySelector('.titulo-bloco') || {}).textContent || '';
            return titulo.trim().toLowerCase() === 'outros';
        }

        function aplicarEstruturaOutros(card) {
            const ehOutros = ehCardOutros(card);
            const form = card.querySelector('.card-gasto-mensal-form');
            const campoDescricao = form.querySelector('.campo-descricao-mensal');
            const thead = card.querySelector('.tabela-gasto-mensal thead tr');
            const tbody = card.querySelector('.tabela-gasto-mensal tbody');

            if (ehOutros) {
                if (!campoDescricao) {
                    const div = document.createElement('div');
                    div.className = 'campo campo-descricao-mensal';
                    div.innerHTML = '<label>Descrição</label><input type="text" name="descricao" placeholder="Ex: Compras diversas">';
                    const valorCampo = form.querySelector('.campo input[name="valor"]');
                    valorCampo.closest('.campo').before(div);
                }
                if (!thead.querySelector('th:nth-child(2)') || thead.cells[1].textContent !== 'Descrição') {
                    const thValor = thead.querySelector('th:nth-child(2)');
                    const thDesc = document.createElement('th');
                    thDesc.textContent = 'Descrição';
                    thead.insertBefore(thDesc, thValor);
                    tbody.querySelectorAll('tr').forEach(function (tr) {
                        const tdValor = tr.querySelector('.valor-real') || tr.cells[1];
                        const tdDesc = document.createElement('td');
                        tdDesc.textContent = tr.dataset.descricao || '';
                        tr.insertBefore(tdDesc, tdValor);
                    });
                }
            } else {
                if (campoDescricao) campoDescricao.remove();
                const thDesc = thead.querySelector('th:nth-child(2)');
                if (thDesc && thDesc.textContent === 'Descrição') {
                    thDesc.remove();
                    tbody.querySelectorAll('tr').forEach(function (tr) {
                        if (tr.cells.length >= 4) tr.cells[1].remove();
                    });
                }
            }
        }

        function criarLinhaGastoMensal(data, valor, descricao) {
            const tr = document.createElement('tr');
            tr.dataset.data = data;
            tr.dataset.valor = valor;
            if (descricao !== undefined) tr.dataset.descricao = descricao || '';
            const tdDesc = (descricao !== undefined) ? '<td>' + escapeHtml(descricao || '') + '</td>' : '';
            tr.innerHTML =
                '<td>' + formatarData(data) + '</td>' +
                (tdDesc) +
                '<td class="valor-real">R$ ' + formatarValor(valor) + '</td>' +
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
                gastosFixos.push({
                    vencimento: tr.dataset.vencimento,
                    descricao: tr.dataset.descricao,
                    tipo: tr.dataset.tipo,
                    valor: parseFloat(tr.dataset.valor || 0),
                    pago: tr.dataset.pago === 'true'
                });
            });
            const gastosVariaveis = [];
            document.querySelectorAll('#tabela-gastos-variaveis tbody tr').forEach(function (tr) {
                gastosVariaveis.push({
                    vencimento: tr.dataset.vencimento,
                    descricao: tr.dataset.descricao,
                    tipo: tr.dataset.tipo,
                    valor: parseFloat(tr.dataset.valor || 0),
                    pago: tr.dataset.pago === 'true'
                });
            });
            const gastosMensais = [];
            document.querySelectorAll('.card-gasto-mensal').forEach(function (card) {
                const titulo = (card.querySelector('.titulo-bloco') || {}).textContent || '';
                const limiteInput = card.querySelector('.input-limite');
                const limite = parsearValorMoeda(limiteInput ? limiteInput.value : '');
                const comDescricao = titulo.trim().toLowerCase() === 'outros';
                const items = [];
                card.querySelectorAll('.tabela-gasto-mensal tbody tr').forEach(function (tr) {
                    const item = { data: tr.dataset.data, valor: parseFloat(tr.dataset.valor || 0) };
                    if (comDescricao) item.descricao = tr.dataset.descricao || '';
                    items.push(item);
                });
                gastosMensais.push({ id: card.dataset.id, titulo: titulo, limite: limite, items: items });
            });
            const receitas = [];
            document.querySelectorAll('#tabela-receitas tbody tr').forEach(function (tr) {
                receitas.push({
                    data: tr.dataset.data,
                    tipo: tr.dataset.tipo,
                    valor: parseFloat(tr.dataset.valor || 0)
                });
            });
            const ganhosFuturos = [];
            document.querySelectorAll('#tabela-ganhos-futuros tbody tr').forEach(function (tr) {
                ganhosFuturos.push({
                    data: tr.dataset.data,
                    tipo: tr.dataset.tipo,
                    valor: parseFloat(tr.dataset.valor || 0)
                });
            });
            return { gastosFixos, gastosVariaveis, gastosMensais, receitas, ganhosFuturos };
        }

        function saveState() {
            if (state.mesAtivo) {
                state.meses[state.mesAtivo] = getStateFromDOM();
            }
            saveToDB(state);
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
                const tr = criarLinhaTabela(g.vencimento, g.descricao, g.tipo, g.valor, g.pago);
                tbodyFixos.appendChild(tr);
                vincularEventosLinha(tr, formFixo, 'tabela-gastos-fixos', btnFixo, btnCancelFixo);
            });
            tbodyVariaveis.innerHTML = '';
            (monthData.gastosVariaveis || []).slice().sort(function (a, b) {
                return (a.vencimento || '').localeCompare(b.vencimento || '');
            }).forEach(function (g) {
                const tr = criarLinhaTabela(g.vencimento, g.descricao, g.tipo, g.valor, g.pago);
                tbodyVariaveis.appendChild(tr);
                vincularEventosLinha(tr, formVariavel, 'tabela-gastos-variaveis', btnVar, btnCancelVar);
            });

            listaGastosMensais.innerHTML = '';
            (monthData.gastosMensais || []).forEach(function (c) {
                criarCardGastoMensal(c);
            });

            const tbodyReceitas = document.querySelector('#tabela-receitas tbody');
            const tbodyGanhosFuturos = document.querySelector('#tabela-ganhos-futuros tbody');
            tbodyReceitas.innerHTML = '';
            (monthData.receitas || []).forEach(function (r) {
                const tr = criarLinhaReceita(r.data, r.tipo, r.valor);
                tbodyReceitas.appendChild(tr);
                vincularEventosLinhaReceita(tr, formReceitas.querySelector('.btn-adicionar'), formReceitas.querySelector('.btn-cancelar-edicao'));
            });
            tbodyGanhosFuturos.innerHTML = '';
            (monthData.ganhosFuturos || []).forEach(function (g) {
                const tr = criarLinhaGanhosFuturos(g.data, g.tipo, g.valor);
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
                cardParaExcluir.remove();
                if (cardMensalRef) verificarLimiteCard(cardMensalRef);
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

        // --- Backup de dados ---
        var BACKUP_STORAGE_KEY = 'sorpes-cell-ultimo-backup';

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
            var nome = 'sorpes-cell-backup-' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + '-' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + '.json';
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
        var btnToggleTotais = document.getElementById('btn-toggle-totais');
        var totaisExtras = document.getElementById('totais-extras');
        if (btnToggleTotais && cabecalhoTotais) {
            btnToggleTotais.addEventListener('click', function () {
                var expandido = cabecalhoTotais.classList.toggle('expandido');
                btnToggleTotais.setAttribute('aria-expanded', expandido ? 'true' : 'false');
                if (totaisExtras) totaisExtras.setAttribute('aria-hidden', expandido ? 'false' : 'true');
                var textoEl = btnToggleTotais.querySelector('.btn-toggle-texto');
                if (textoEl) textoEl.textContent = expandido ? 'Ver menos' : 'Ver mais';
            });
        }

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

        loadFromDB().then(function (loaded) {
            if (loaded && loaded.meses && Object.keys(loaded.meses).length > 0) {
                state.meses = loaded.meses;
                state.mesAtivo = loaded.mesAtivo || '2026-02';
                if (!state.meses[state.mesAtivo]) {
                    state.mesAtivo = Object.keys(state.meses).sort().reverse()[0];
                }
                state.anoAtivo = loaded.anoAtivo || (state.mesAtivo ? state.mesAtivo.split('-')[0] : '2026');
            } else if (loaded && (loaded.gastosFixos || loaded.receitas || loaded.gastosMensais)) {
                state.meses['2026-02'] = loaded;
                state.mesAtivo = '2026-02';
                state.anoAtivo = '2026';
            } else {
                state.meses['2026-02'] = getEmptyMonthData();
                state.mesAtivo = '2026-02';
                state.anoAtivo = '2026';
            }
            renderYearTabs();
            renderMonthTabs();
            restoreState(state.meses[state.mesAtivo] || getEmptyMonthData());
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
