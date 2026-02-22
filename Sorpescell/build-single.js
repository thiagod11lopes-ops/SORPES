const fs = require('fs');
const path = require('path');
const dir = __dirname;
let index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(dir, 'script.js'), 'utf8');

index = index.replace('<link rel="manifest" href="manifest.json">\n    ', '');
index = index.replace('    <link rel="stylesheet" href="style.css">\n    ', '');
index = index.replace('</head>', '<style>\n' + css + '\n    </style>\n</head>');

const scriptTag = '<script src="script.js"></script>';
const idx = index.indexOf(scriptTag);
if (idx !== -1) {
    const afterFirst = index.indexOf('</script>', idx) + 9;
    const segundoScript = index.indexOf('<script>', afterFirst);
    const fimSegundo = index.indexOf('</script>', segundoScript) + 9;
    index = index.slice(0, idx) + '<script>\n' + js + '\n    </script>\n' + index.slice(fimSegundo);
}

fs.writeFileSync(path.join(dir, 'Sorpescell.html'), index, 'utf8');
console.log('Sorpescell.html created.');
