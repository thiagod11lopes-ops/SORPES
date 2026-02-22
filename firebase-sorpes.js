/**
 * SORPES - Integração Firebase Firestore
 * Salva e carrega o estado completo do sistema na nuvem.
 */
(function () {
    'use strict';

    var firebaseConfig = {
        apiKey: "AIzaSyCaOiSyyF8p2WLkNgzQp6MeoMbgJdN6d6g",
        authDomain: "sorpes-9ddcb.firebaseapp.com",
        projectId: "sorpes-9ddcb",
        storageBucket: "sorpes-9ddcb.firebasestorage.app",
        messagingSenderId: "675416702295",
        appId: "1:675416702295:web:99c82aa9f7497b11edd212",
        measurementId: "G-9Z5GZXBPSZ"
    };

    var app;
    var db;
    var COLLECTION = 'sorpes';
    var DOC_ID = 'estado';

    if (typeof firebase === 'undefined') {
        console.warn('SORPES Firebase: SDK não carregou. Abra o site por http:// (ex.: Live Server), não por file://.');
    } else {
        try {
            app = firebase.initializeApp(firebaseConfig);
            db = firebase.firestore(app);
        } catch (e) {
            console.warn('SORPES Firebase: inicialização falhou.', e);
        }
    }

    /**
     * Salva o estado completo no Firestore (assíncrono, não bloqueia a UI).
     * @param {Object} state - Objeto state do SORPES (meses, mesAtivo, anoAtivo, usuarios)
     */
    function salvarEstado(state) {
        if (!db) {
            console.warn('SORPES Firebase: Firestore não disponível. Abra o site por http:// (não file://).');
            return Promise.resolve();
        }
        if (!state) return Promise.resolve();
        try {
            var payload = {
                dados: JSON.stringify(state),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            return db.collection(COLLECTION).doc(DOC_ID).set(payload).catch(function (err) {
                console.warn('SORPES Firebase: erro ao salvar.', err);
                if (err && err.code === 'permission-denied') {
                    console.warn('SORPES Firebase: regras do Firestore negaram. No Console do Firebase, em Firestore > Regras, use allow read, write: if true; (só para teste).');
                }
            });
        } catch (e) {
            console.warn('SORPES Firebase: erro ao salvar.', e);
            return Promise.resolve();
        }
    }

    /**
     * Carrega o estado salvo no Firestore.
     * @returns {Promise<Object|null>} Estado parseado ou null se não houver dados/erro
     */
    function carregarEstado() {
        if (!db) return Promise.resolve(null);
        return db.collection(COLLECTION).doc(DOC_ID).get()
            .then(function (snap) {
                if (!snap || !snap.exists) return null;
                var data = snap.data();
                var json = data && data.dados;
                if (!json || typeof json !== 'string') return null;
                return JSON.parse(json);
            })
            .catch(function (err) {
                console.warn('SORPES Firebase: erro ao carregar.', err);
                return null;
            });
    }

    window.sorpesFirebase = {
        salvarEstado: salvarEstado,
        carregarEstado: carregarEstado
    };
})();
