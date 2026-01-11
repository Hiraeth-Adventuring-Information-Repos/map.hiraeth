
class TextToolbar {
    constructor(textareaIds) {
        this.textareaIds = textareaIds;
        this.init();
    }

    init() {
        this.textareaIds.forEach(id => {
            const textarea = document.getElementById(id);
            if (!textarea) return;

            const toolbar = document.createElement('div');
            toolbar.className = 'text-toolbar';

            const btnBold = this.createButton('B', 'Bold', () => this.insertTags(textarea, '<b>', '</b>'));
            const btnItalic = this.createButton('I', 'Italic', () => this.insertTags(textarea, '<i>', '</i>'));
            const btnLink = this.createButton('Link', 'Insert Link', () => this.insertLink(textarea));
            const btnBreak = this.createButton('Br', 'Line Break', () => this.insertText(textarea, '<br>'));

            toolbar.appendChild(btnBold);
            toolbar.appendChild(btnItalic);
            toolbar.appendChild(btnLink);
            toolbar.appendChild(btnBreak);

            // Insert toolbar before textarea
            textarea.parentNode.insertBefore(toolbar, textarea);
        });
    }

    createButton(text, title, onClick) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.title = title;
        btn.type = 'button'; // Prevent form submission if inside form
        btn.className = 'toolbar-btn';
        btn.onclick = (e) => {
            e.preventDefault();
            onClick();
        };
        return btn;
    }

    insertTags(textarea, startTag, endTag) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selectedText = text.substring(start, end);
        const replacement = startTag + selectedText + endTag;
        textarea.setRangeText(replacement, start, end, 'select');
        textarea.focus();
    }

    insertText(textarea, textToInsert) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.setRangeText(textToInsert, start, end, 'end');
        textarea.focus();
    }

    insertLink(textarea) {
        const url = prompt("Enter URL:", "https://");
        if (url) {
            this.insertTags(textarea, `<a href="${url}" target="_blank">`, '</a>');
        }
    }
}
