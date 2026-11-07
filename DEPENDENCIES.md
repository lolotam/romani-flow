# ROMANI Management System - Dependencies Documentation

## Production Dependencies

### Core Framework & Libraries
```json
"react": "^18.3.1"                    // React framework for UI
"react-dom": "^18.3.1"               // React DOM for rendering
"react-router-dom": "^6.30.1"        // Client-side routing
```

### UI Components & Styling
```json
"@radix-ui/react-*": "^1.x.x"        // Radix UI primitives (35+ components)
"tailwind-merge": "^2.6.0"           // Tailwind CSS class merging
"tailwindcss-animate": "^1.0.7"      // Animation utilities
"class-variance-authority": "^0.7.1" // Component variant management
"clsx": "^2.1.1"                     // Conditional CSS classes
"framer-motion": "^11.18.2"          // Animation library
"lucide-react": "^0.462.0"           // Icon library
"next-themes": "^0.3.0"              // Theme management
```

### Form Handling & Validation
```json
"react-hook-form": "^7.61.1"         // Form library
"@hookform/resolvers": "^3.10.0"     // Form resolvers
"zod": "^3.25.76"                    // Schema validation
"input-otp": "^1.4.2"               // OTP input component
```

### Data Management & APIs
```json
"@tanstack/react-query": "^5.83.0"   // Server state management
"@tanstack/react-table": "^8.21.3"   // Table component with sorting/filtering
"date-fns": "^3.6.0"                 // Date manipulation library
```

### Email Services
```json
"@emailjs/browser": "^4.4.1"         // Client-side email service
"nodemailer": "^7.0.6"               // Server-side email service
"@types/nodemailer": "^7.0.1"        // TypeScript types for nodemailer
```

### UI Utilities
```json
"react-day-picker": "^8.10.1"        // Date picker component
"react-dropzone": "^14.3.8"          // File upload with drag-and-drop
"react-resizable-panels": "^2.1.9"   // Resizable panel layout
"embla-carousel-react": "^8.6.0"     // Carousel component
"recharts": "^2.15.4"                // Chart library
"sonner": "^1.7.4"                   // Toast notifications
"vaul": "^0.9.9"                     // Drawer component
"cmdk": "^1.1.1"                     // Command menu
```

### AI document extraction (optional, off by default)
```json
"pdfjs-dist": "6.5.438"              // Pinned PDF renderer (exact version, no range)
"sharp": "0.35.5"                    // Native image decoder for the server
```

Both dependencies serve one optional feature that is **disabled by default**
and requires an explicit owner authorization before any document is processed.
See [`docs/AI_DOCUMENT_EXTRACTION.md`](docs/AI_DOCUMENT_EXTRACTION.md).

`pdfjs-dist` is pinned to an exact version on purpose: the renderer is
configured to report its own diagnostics instead of swallowing them, and that
behaviour is verified against one specific release. The version is also the
name of the local asset directory, so the application always renders with the
files of the installed release.

`sharp` is the default decoder of the server-side image admission. It is the
one native addition of this feature; `node:sqlite` was chosen deliberately for
the database precisely because it needs no native compilation. The runtime
image installs the production dependencies with `npm ci --omit=dev` on
`node:24-alpine`, so the `sharp` binary has to be resolvable in that stage. No
Docker build of the image was run in this documentation checkout, so the image
build itself is not claimed to be verified here.

**Local assets, no CDN.** The renderer reaches no **external** host for an
asset: every asset comes from the application's own origin. The Vite plugin
`romani-pdfjs-assets` reads the installed package and serves exactly four
directories of it, in the development server and in the preview of a build
alike:

```text
/pdfjs/6.5.438/cmaps/
/pdfjs/6.5.438/standard_fonts/
/pdfjs/6.5.438/wasm/
/pdfjs/6.5.438/iccs/
```

Every other path is refused. The build emits exactly the same files under the
same names, so the development server and a built application behave
identically. `pdfjs-dist` is excluded from the dependency pre-bundling, and the
renderer runs in its own ES-module worker.

## Development Dependencies

### Build Tools & Bundlers
```json
"vite": "^5.4.19"                    // Build tool and dev server
"@vitejs/plugin-react-swc": "^3.11.0" // React plugin for Vite with SWC
```

### TypeScript Support
```json
"typescript": "^5.8.3"               // TypeScript compiler
"@types/node": "^22.16.5"            // Node.js type definitions
"@types/react": "^18.3.23"           // React type definitions
"@types/react-dom": "^18.3.7"        // React DOM type definitions
```

### Code Quality & Linting
```json
"eslint": "^9.32.0"                  // JavaScript/TypeScript linter
"@eslint/js": "^9.32.0"              // ESLint JavaScript configuration
"typescript-eslint": "^8.38.0"       // TypeScript ESLint integration
"eslint-plugin-react-hooks": "^5.2.0" // React Hooks ESLint rules
"eslint-plugin-react-refresh": "^0.4.20" // React Refresh ESLint plugin
"globals": "^15.15.0"                // Global variables definitions
```

### CSS & Styling Tools
```json
"tailwindcss": "^3.4.17"             // Utility-first CSS framework
"@tailwindcss/typography": "^0.5.16" // Typography plugin for Tailwind
"autoprefixer": "^10.4.21"           // CSS vendor prefixing
"postcss": "^8.5.6"                  // CSS post-processor
```

### Development Tools
```json
"lovable-tagger": "^1.1.9"           // Development tagger tool
```

## Runtime Requirements

### Node.js Version
- **Minimum**: Node.js 18.x
- **Recommended**: Node.js 20.x or later
- **Package Manager**: npm 9.x or yarn 1.22.x

### Browser Compatibility
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers with modern JavaScript support

## Docker Requirements

### Base Images
```dockerfile
FROM node:18-alpine as build    # Build stage
FROM nginx:alpine              # Production stage
```

### System Dependencies
- curl (for health checks)
- nginx (for serving static files)
- SSL certificate support

## Build Process Dependencies

### Required Scripts
```json
"dev": "vite"                  // Development server
"build": "vite build"          // Production build
"build:dev": "vite build --mode development" // Development build
"lint": "eslint ."            // Code linting
"preview": "vite preview"      // Preview production build
```

### Build Output
- **Target Directory**: `dist/`
- **Assets**: JavaScript, CSS, HTML, and static files
- **Optimization**: Code splitting, minification, tree shaking

## Email Service Configuration

### EmailJS Setup
1. Create account at [EmailJS](https://www.emailjs.com/)
2. Configure email service (Gmail, Outlook, etc.)
3. Set environment variables:
   ```
   VITE_EMAILJS_SERVICE_ID=your_service_id
   VITE_EMAILJS_TEMPLATE_ID=your_template_id
   VITE_EMAILJS_PUBLIC_KEY=your_public_key
   ```

### SMTP Configuration (Alternative)
```
VITE_SMTP_HOST=smtp.gmail.com
VITE_SMTP_PORT=587
VITE_SMTP_USER=your_email@gmail.com
VITE_SMTP_PASS=your_app_password
```

## Deployment Dependencies

### Production Server Requirements
- Docker Engine 20.10+
- Docker Compose 2.0+
- Nginx (for reverse proxy)
- Certbot (for SSL certificates)
- Port 80/443 availability

### SSL Certificate
- Let's Encrypt via Certbot
- Domain ownership verification
- Automatic renewal setup

## Development Setup

### Installation Steps
1. Clone repository
2. Install Node.js 18+
3. Run `npm install`
4. Configure environment variables
5. Run `npm run dev`

### Build & Deploy
1. Run `npm run build`
2. Build Docker image: `docker build -t romani-app .`
3. Deploy with: `docker-compose up -d`

## Security Considerations

### Dependencies Security
- Regular security audits with `npm audit`
- Automated dependency updates
- No known vulnerabilities in current versions

### Runtime Security
- HTTPS required in production
- Secure headers in nginx configuration
- Client-side data validation
- Sanitized HTML templates