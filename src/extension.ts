import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let liminalPanel: LiminalPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Liminal Spaces extension is now active!');
    
    // Enregistrer la commande pour ouvrir le viewer
    let disposable = vscode.commands.registerCommand('liminalSpaces.openViewer', () => {
        if (liminalPanel) {
            liminalPanel.reveal();
        } else {
            liminalPanel = new LiminalPanel(context.extensionUri);
        }
    });

    context.subscriptions.push(disposable);

    // Créer le provider pour la sidebar
    const provider = new LiminalViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('liminalSpacesView', provider)
    );

    // Auto-activer l'extension
    vscode.commands.executeCommand('setContext', 'liminalSpaces.enabled', true);
}

export function deactivate() {
    if (liminalPanel) {
        liminalPanel.dispose();
    }
}

class LiminalPanel {
    public static currentPanel: LiminalPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;

        this._panel = vscode.window.createWebviewPanel(
            'liminalSpaces',
            'Liminal Spaces',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'gifs')]
            }
        );

        this._panel.webview.html = this._getHtmlForWebview();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        // Démarrer le slideshow après un petit délai
        setTimeout(() => {
            this._startSlideshow();
        }, 100);
    }

    public reveal() {
        this._panel.reveal();
    }

    public dispose() {
        LiminalPanel.currentPanel = undefined;
        liminalPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _startSlideshow() {
        const config = vscode.workspace.getConfiguration('liminalSpaces');
        const interval = config.get<number>('interval', 5) * 1000;
        const customGifsPath = config.get<string>('gifsPath', '');
        
        let gifFiles: string[];
        
        if (customGifsPath) {
            gifFiles = this._getGifFilesFromCustomPath(customGifsPath);
        } else {
            gifFiles = this._getGifFilesFromExtension();
        }
        
        console.log('Found GIF files:', gifFiles.length);
        
        if (gifFiles.length === 0) {
            vscode.window.showWarningMessage('No GIF files found in gifs folder');
            return;
        }

        this._panel.webview.postMessage({
            command: 'startSlideshow',
            gifFiles: gifFiles,
            interval: interval
        });
    }

    private _getGifFilesFromCustomPath(gifsPath: string): string[] {
        try {
            const fullPath = path.resolve(gifsPath);
            const files = fs.readdirSync(fullPath);
            return files
                .filter(file => file.toLowerCase().endsWith('.gif'))
                .map(file => vscode.Uri.file(path.join(fullPath, file)).toString());
        } catch (error) {
            console.error('Error reading custom GIFs directory:', error);
            return [];
        }
    }

    private _getGifFilesFromExtension(): string[] {
        try {
            const gifsDir = vscode.Uri.joinPath(this._extensionUri, 'gifs');
            console.log('Looking for GIFs in:', gifsDir.fsPath);
            
            if (!fs.existsSync(gifsDir.fsPath)) {
                console.error('GIFs directory does not exist:', gifsDir.fsPath);
                return [];
            }
            
            const files = fs.readdirSync(gifsDir.fsPath);
            console.log('Files found:', files);
            
            return files
                .filter(file => file.toLowerCase().endsWith('.gif'))
                .map(file => {
                    const gifUri = vscode.Uri.joinPath(gifsDir, file);
                    return this._panel.webview.asWebviewUri(gifUri).toString();
                });
        } catch (error) {
            console.error('Error reading extension GIFs directory:', error);
            return [];
        }
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Liminal Spaces</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background-color: #1e1e1e;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    overflow: hidden;
                }
                .container {
                    text-align: center;
                    width: 100%;
                    height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #gifDisplay {
                    max-width: 100%;
                    max-height: 100%;
                    width: auto;
                    height: auto;
                    object-fit: contain;
                    transition: opacity 0.3s ease;
                }
                .loading {
                    color: #cccccc;
                    font-size: 14px;
                }
                .error {
                    color: #ff6b6b;
                    font-size: 14px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <img id="gifDisplay" style="display: none;" />
                <div id="status" class="loading">Initializing liminal spaces...</div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let gifFiles = [];
                let currentIndex = 0;
                let shuffledIndices = [];
                let interval = 5000;
                let slideTimer;

                const gifDisplay = document.getElementById('gifDisplay');
                const status = document.getElementById('status');

                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('Received message:', message);
                    
                    switch (message.command) {
                        case 'startSlideshow':
                            gifFiles = message.gifFiles;
                            interval = message.interval;
                            console.log('Starting slideshow with', gifFiles.length, 'files');
                            initializeSlideshow();
                            break;
                    }
                });

                function initializeSlideshow() {
                    if (gifFiles.length === 0) {
                        status.textContent = 'No GIF files found';
                        status.className = 'error';
                        return;
                    }

                    shuffledIndices = shuffleArray([...Array(gifFiles.length).keys()]);
                    currentIndex = 0;
                    showNextGif();
                    startTimer();
                }

                function shuffleArray(array) {
                    const shuffled = [...array];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    return shuffled;
                }

                function showNextGif() {
                    if (currentIndex >= shuffledIndices.length) {
                        shuffledIndices = shuffleArray([...Array(gifFiles.length).keys()]);
                        currentIndex = 0;
                    }

                    const gifIndex = shuffledIndices[currentIndex];
                    const gifPath = gifFiles[gifIndex];
                    console.log('Loading GIF:', gifPath);
                    
                    const img = new Image();
                    img.onload = () => {
                        gifDisplay.src = gifPath;
                        gifDisplay.style.display = 'block';
                        status.style.display = 'none';
                        console.log('GIF loaded successfully');
                    };
                    img.onerror = () => {
                        console.error('Failed to load GIF:', gifPath);
                        currentIndex++;
                        if (currentIndex < shuffledIndices.length) {
                            showNextGif();
                        } else {
                            status.textContent = 'Error loading GIFs';
                            status.className = 'error';
                        }
                        return;
                    };
                    img.src = gifPath;
                    
                    currentIndex++;
                }

                function startTimer() {
                    if (slideTimer) {
                        clearInterval(slideTimer);
                    }
                    
                    slideTimer = setInterval(() => {
                        showNextGif();
                    }, interval);
                }
            </script>
        </body>
        </html>`;
    }
}

class LiminalViewProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'gifs')]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Délai pour s'assurer que la webview est prête
        setTimeout(() => {
            this._startSlideshow(webviewView.webview);
        }, 100);
    }

    private _startSlideshow(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('liminalSpaces');
        const interval = config.get<number>('interval', 5) * 1000;
        const customGifsPath = config.get<string>('gifsPath', '');
        
        let gifFiles: string[];
        
        if (customGifsPath) {
            gifFiles = this._getGifFilesFromCustomPath(customGifsPath);
        } else {
            gifFiles = this._getGifFilesFromExtension(webview);
        }
        
        console.log('Sidebar: Found GIF files:', gifFiles.length);
        
        if (gifFiles.length === 0) {
            return;
        }

        webview.postMessage({
            command: 'startSlideshow',
            gifFiles: gifFiles,
            interval: interval
        });
    }

    private _getGifFilesFromCustomPath(gifsPath: string): string[] {
        try {
            const fullPath = path.resolve(gifsPath);
            const files = fs.readdirSync(fullPath);
            return files
                .filter(file => file.toLowerCase().endsWith('.gif'))
                .map(file => vscode.Uri.file(path.join(fullPath, file)).toString());
        } catch (error) {
            console.error('Error reading custom GIFs directory:', error);
            return [];
        }
    }

    private _getGifFilesFromExtension(webview: vscode.Webview): string[] {
        try {
            const gifsDir = vscode.Uri.joinPath(this._extensionUri, 'gifs');
            
            if (!fs.existsSync(gifsDir.fsPath)) {
                console.error('GIFs directory does not exist:', gifsDir.fsPath);
                return [];
            }
            
            const files = fs.readdirSync(gifsDir.fsPath);
            return files
                .filter(file => file.toLowerCase().endsWith('.gif'))
                .map(file => {
                    const gifUri = vscode.Uri.joinPath(gifsDir, file);
                    return webview.asWebviewUri(gifUri).toString();
                });
        } catch (error) {
            console.error('Error reading extension GIFs directory:', error);
            return [];
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Liminal Spaces</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background-color: #252526;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    overflow: hidden;
                }
                .container {
                    text-align: center;
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #gifDisplay {
                    max-width: 100%;
                    max-height: 100%;
                    width: auto;
                    height: auto;
                    object-fit: contain;
                }
                .loading {
                    color: #cccccc;
                    font-size: 12px;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <img id="gifDisplay" style="display: none;" />
                <div id="status" class="loading">Loading...</div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let gifFiles = [];
                let currentIndex = 0;
                let shuffledIndices = [];
                let interval = 5000;
                let slideTimer;

                const gifDisplay = document.getElementById('gifDisplay');
                const status = document.getElementById('status');

                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.command) {
                        case 'startSlideshow':
                            gifFiles = message.gifFiles;
                            interval = message.interval;
                            initializeSlideshow();
                            break;
                    }
                });

                function initializeSlideshow() {
                    if (gifFiles.length === 0) {
                        status.textContent = 'No GIFs';
                        return;
                    }

                    shuffledIndices = shuffleArray([...Array(gifFiles.length).keys()]);
                    currentIndex = 0;
                    showNextGif();
                    startTimer();
                }

                function shuffleArray(array) {
                    const shuffled = [...array];
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                    }
                    return shuffled;
                }

                function showNextGif() {
                    if (currentIndex >= shuffledIndices.length) {
                        shuffledIndices = shuffleArray([...Array(gifFiles.length).keys()]);
                        currentIndex = 0;
                    }

                    const gifIndex = shuffledIndices[currentIndex];
                    const gifPath = gifFiles[gifIndex];
                    
                    const img = new Image();
                    img.onload = () => {
                        gifDisplay.src = gifPath;
                        gifDisplay.style.display = 'block';
                        status.style.display = 'none';
                    };
                    img.onerror = () => {
                        currentIndex++;
                        if (currentIndex < shuffledIndices.length) {
                            showNextGif();
                        }
                        return;
                    };
                    img.src = gifPath;
                    
                    currentIndex++;
                }

                function startTimer() {
                    if (slideTimer) {
                        clearInterval(slideTimer);
                    }
                    
                    slideTimer = setInterval(() => {
                        showNextGif();
                    }, interval);
                }
            </script>
        </body>
        </html>`;
    }
}