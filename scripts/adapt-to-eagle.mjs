import fs from 'fs';
import path from 'path';

const replacements = [
  // Roles
  { from: /proprietario/g, to: 'administrador' },
  { from: /barbeiro/g, to: 'tecnico' },

  // Labels em português
  { from: /proprietário/gi, to: 'administrador' },
  { from: /barbeiro/gi, to: 'técnico' },

  // Nomes específicos da barbearia
  { from: /cadeira/gi, to: 'local' },
  { from: /cabelo/gi, to: 'serviço' },
  { from: /barba/gi, to: 'garantia' },

  // Referências ao MARFIM
  { from: /MARFIM/g, to: 'Eagle' },
  { from: /marfim/g, to: 'eagle' },
];

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(file => {
    const filepath = path.join(dir, file);
    if (fs.statSync(filepath).isDirectory()) {
      if (!filepath.includes('node_modules') && !filepath.includes('.next') && !filepath.includes('.data')) {
        walkDir(filepath, callback);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.json')) {
      callback(filepath);
    }
  });
}

walkDir('./src', filepath => {
  try {
    let content = fs.readFileSync(filepath, 'utf8');
    let changed = false;

    for (const { from, to } of replacements) {
      if (from.test(content)) {
        content = content.replace(from, to);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filepath, content);
      console.log(`✓ ${filepath}`);
    }
  } catch (e) {
    console.error(`✗ ${filepath}:`, e.message);
  }
});

console.log('\n✓ Adaptações concluídas!');
