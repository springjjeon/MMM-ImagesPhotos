
const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '..', 'views');

function render(templateName, data) {
    const templatePath = path.join(viewsDir, `${templateName}.html`);
    if (!fs.existsSync(templatePath)) {
        console.error(`[View Renderer] Template not found: ${templatePath}`);
        return 'Error: Template not found.';
    }

    let template = fs.readFileSync(templatePath, 'utf-8');

    // Replace all {{variable}} placeholders with data from the data object
    for (const key in data) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        template = template.replace(regex, data[key]);
    }

    return template;
}

module.exports = { render };
