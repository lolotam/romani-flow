import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "node:fs";
import path from "path";
import { createRequire } from "node:module";
import type { ServerResponse } from "node:http";
import { componentTagger } from "lovable-tagger";
import { pdfAssetBase, pdfAssetDirectories } from "./src/lib/extraction/pdfAssets";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // The SPA calls the API on the same origin, so in development the requests
    // are proxied to the local API server.
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://127.0.0.1:3000",
        // Preserve the browser's host so backend same-origin mutation checks
        // also work through the development proxy, without trusting forwarded hosts.
        changeOrigin: false,
      },
      "/health": {
        target: process.env.VITE_API_URL ?? "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
    pdfAssetsPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // The pinned PDF.js release is served as it is. The optimizer would
    // discover it while the page runs and would reload the page, so the
    // release is excluded from the pre-bundling of the dependencies.
    exclude: ["pdfjs-dist"],
  },
  // The PDF renderer runs in its own module worker, so the worker has to be
  // an ES module as well.
  worker: {
    format: "es",
  },
  build: {
    // The legacy bundle of PDF.js supports the older browser APIs, so the
    // application is built for the same language level.
    target: "es2022",
  },
  // Ensure documents are served correctly
  publicDir: 'public',
  assetsInclude: ['**/*.pdf', '**/*.doc', '**/*.docx', '**/*.jpg', '**/*.jpeg', '**/*.png', '**/*.gif'],
}));

/**
 * The root of the installed PDF.js release.
 *
 * The assets are read from the installed package, so the build and the
 * development server always serve the files of the pinned version.
 */
const pdfjsRoot = path.dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);

/** The content types of the bundled assets. */
const contentTypes: Record<string, string> = {
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".icc": "application/vnd.iccprofile",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Lists every file of a directory.
 *
 * The list is the whole directory tree, so the license files of the release
 * travel with the assets they belong to.
 */
function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Builds the allowlist of the bundled PDF.js assets.
 *
 * The allowlist maps a public URL to the file that answers it. Nothing else
 * is ever served: a request is never turned into a path of the file system.
 */
function collectPdfAssets(): Map<string, string> {
  const assets = new Map<string, string>();
  for (const directory of pdfAssetDirectories) {
    const root = path.join(pdfjsRoot, directory);
    if (!fs.existsSync(root)) continue;
    for (const file of listFiles(root)) {
      const relative = path.relative(root, file).split(path.sep).join("/");
      assets.set(`${pdfAssetBase}${directory}/${relative}`, file);
    }
  }
  const license = path.join(pdfjsRoot, "LICENSE");
  if (fs.existsSync(license)) assets.set(`${pdfAssetBase}LICENSE`, license);
  return assets;
}

/** Reads the content type of a bundled asset. */
function contentTypeOf(file: string): string {
  return contentTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Serves and emits the local PDF.js assets.
 *
 * The development server and the preview of a build answer only the files of
 * the allowlist and refuse every other path. The build emits exactly the
 * same files under the same names, so the application behaves the same in
 * both modes and never reaches a network host for an asset.
 */
function pdfAssetsPlugin(): Plugin {
  let assets = new Map<string, string>();
  return {
    name: "romani-pdfjs-assets",
    configResolved() {
      assets = collectPdfAssets();
    },
    configureServer(server) {
      assets = collectPdfAssets();
      server.middlewares.use((request, response, next) => {
        const requested = (request.url ?? "").split("?")[0];
        if (!requested.startsWith(pdfAssetBase)) {
          next();
          return;
        }
        const file = assets.get(requested);
        if (!file) {
          refuseAsset(response);
          return;
        }
        sendAsset(response, file);
      });
    },
    configurePreviewServer(server) {
      assets = collectPdfAssets();
      server.middlewares.use((request, response, next) => {
        const requested = (request.url ?? "").split("?")[0];
        if (!requested.startsWith(pdfAssetBase)) {
          next();
          return;
        }
        const file = assets.get(requested);
        if (!file) {
          refuseAsset(response);
          return;
        }
        const built = path.resolve(
          server.config.root,
          server.config.build.outDir,
          requested.slice(1),
        );
        if (!fs.existsSync(built)) { response.statusCode = 404; response.end("Missing built PDF asset"); return; }
        sendAsset(response, built);
      });
    },
    buildStart() {
      assets = collectPdfAssets();
    },
    generateBundle() {
      for (const [url, file] of assets) {
        this.emitFile({
          type: "asset",
          fileName: url.slice(1),
          source: fs.readFileSync(file),
        });
      }
    },
  };
}

/** Refuses an asset that is not part of the local PDF.js assets. */
function refuseAsset(response: ServerResponse): void {
  response.statusCode = 403;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("This asset is not part of the local PDF.js assets.");
}

/** Answers a request with one of the local PDF.js assets. */
function sendAsset(response: ServerResponse, file: string): void {
  response.setHeader("Content-Type", contentTypeOf(file));
  fs.createReadStream(file).pipe(response);
}
