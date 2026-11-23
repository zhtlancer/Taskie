// Tabs explicitly delimit columns. Otherwise recognize a Chinese meaning after
// whitespace, retaining spaces inside phrases and punctuation inside meanings.
function parseEnglishImportText(text) {
  return text.split(/\r?\n|\r/).flatMap((line, index) => {
    if (!line.trim()) return [];
    const row = columns => ({ raw: line, columns, line_number: index + 1 });
    if (line.includes('\t')) return [row(line.split('\t'))];
    const chineseStart = line.search(/\p{Script=Han}/u);
    if (chineseStart >= 0) {
      let separator = -1;
      // Scan once: a separator must be followed only by opening punctuation
      // and whitespace before the first Chinese character.
      for (let i = 0; i < chineseStart; i++) {
        if (/\s/u.test(line[i])) {
          if (separator < 0) separator = i;
        } else if (!/[（(【\[“"‘'「『]/u.test(line[i])) separator = -1;
      }
      // An unrecognized mixed-language row stays whole so a comma cannot turn
      // an invalid entry into a partially imported English word.
      return [row(separator >= 0 ? [line.slice(0, separator), line.slice(separator).trim()] : [line])];
    }
    return line.split(/[,;，；、]+/).map(raw => raw.trim()).filter(Boolean)
      .map(raw => ({ raw, columns: [raw], line_number: index + 1 }));
  });
}

module.exports = { parseEnglishImportText };
