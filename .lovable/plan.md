

# Document Preview with Image Placeholder & Download Button

## What needs to change

Currently, the "View Document" dialog in both `Documents.tsx` and `EmployeeDocuments.tsx` has different levels of file preview support. The `EmployeeDocuments.tsx` view dialog already handles image/PDF preview with placeholders, but `Documents.tsx` view dialog has **no file preview at all** — it only shows metadata. Additionally, the document cards themselves don't show any image thumbnail/placeholder.

## Plan

### 1. Add File Preview Section to Documents.tsx View Dialog
**File**: `src/pages/Documents.tsx` (lines 832-904)

Add a file preview section before the metadata grid (matching what EmployeeDocuments.tsx already has at lines 824-891):
- If file is an image (base64 `data:image`), render `<img>` preview
- If file is a PDF (base64 `data:application/pdf`), render `<iframe>` preview
- If file path exists but isn't base64, show a placeholder icon with "file unavailable" message
- If no file at all, show a generic document placeholder icon

### 2. Add Image Thumbnail to Document Cards
**File**: `src/pages/Documents.tsx` — `DocumentCard` component (lines 413-489)
**File**: `src/pages/EmployeeDocuments.tsx` — document card area

Add a thumbnail preview area at the top of each document card:
- For image documents with base64 data: show a small thumbnail
- For PDFs or other files: show a styled placeholder with a `FileText` icon
- Use `aspect-ratio` container for consistent card sizing

### 3. Fix Download Button Functionality
**File**: `src/pages/Documents.tsx` — `handleDownloadDocument` (lines 360-412)

The download function already works for base64 files. Ensure it handles all cases:
- Base64 data URLs: create an `<a>` tag with `href` pointing to the data URL and trigger download
- Proper `file_name` fallback when `file_name` is missing (use title + extension from MIME type)

Also add a working download button in the Documents.tsx view dialog (already present at line 889-895, just verify `handleDownloadDocument` handles the `selectedDocument` correctly).

### 4. Ensure EmployeeDocuments.tsx View Dialog Download Works
**File**: `src/pages/EmployeeDocuments.tsx` (lines 936-943)

The download button at line 938 already calls `handleDownloadDocument(selectedDocument)` — verify the function handles null `file_path` gracefully with a toast error.

## Technical Details

- Documents store files as base64 in `file_path` field (e.g., `data:image/png;base64,...` or `data:application/pdf;base64,...`)
- File type detection uses both `file_name` extension and `file_path` prefix
- Placeholder image: use the existing `FileText` icon from lucide-react styled in a muted container
- No new dependencies needed

## Files Modified
1. `src/pages/Documents.tsx` — Add preview section to view dialog + thumbnail to cards
2. `src/pages/EmployeeDocuments.tsx` — Add thumbnail to document cards (view dialog already has preview)

