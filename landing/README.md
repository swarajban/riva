# Riva Landing Page

Static marketing landing page for riva.systems.

## Structure

```
landing/
  index.html    # Single-file landing page (HTML + CSS + JS)
```

## Development

Simply open `index.html` in a browser:

```bash
open index.html
```

Or use a local server:

```bash
npx serve .
# or
python -m http.server 8000
```

## Deployment

This is a static site - deploy to any static hosting provider:

### Vercel

```bash
cd landing
npx vercel
```

### Netlify

```bash
cd landing
npx netlify deploy --prod
```

### Cloudflare Pages

1. Create a new Pages project
2. Set build output directory to `landing/`
3. No build command needed

### GitHub Pages

1. Push `landing/` contents to a `gh-pages` branch
2. Configure domain in GitHub settings

## Configuration

Update `https://app.riva.systems/auth/user/login` links if the sign-up URL changes.

## Design Notes

- Fonts: DM Serif Display (headlines) + Plus Jakarta Sans (body)
- Colors: Warm neutral palette with amber accent (#b8845c)
- Animations: Scroll-triggered reveals, email thread animation
- Mobile: Responsive down to 320px
