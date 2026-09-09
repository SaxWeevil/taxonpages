# TaxonPages Template

A GitHub template for creating your own [TaxonPages](https://github.com/SpeciesFileGroup/taxonpages/tree/package) site. TaxonPages serves taxon pages using data from a TaxonWorks instance (and is designed to remain data-source agnostic).

This repository is meant to be used directly from GitHub: click **Use this template**, edit a couple of configuration files in the browser, and GitHub Actions will build and publish your site to GitHub Pages — no local setup required.

## Requirements

- A [GitHub](https://github.com) account
- A [TaxonWorks](https://taxonworks.org) instance with an API URL and a project token

(Running the site on your own computer additionally requires [Node.js](https://nodejs.org/en/download/) ≥ 20.19.0 or ≥ 22.12.0 — see [Local development](#local-development).)

## Quick start

Every commit to your repository's `main` branch triggers the **Deploy to GitHub Pages** workflow, which builds the site and publishes it automatically. You can do everything below from the GitHub website.

1. **Create your repository from this template.**  
   Click the green **Use this template** button at the top of this repository, then **Create a new repository**. Name it `taxonpages` unless you have a reason to pick a different name — using this exact name means you won't have to change `config/router.yml` later.

2. **Enable GitHub Pages.**  
   In your new repository, go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.

3. **Configure the TaxonWorks API.**  
   Open `config/api.yml`, click the pencil icon to edit it, and fill in your TaxonWorks URL and project token:

   ```yaml
   url: https://your-taxonworks-instance/api/v1
   project_token: YOUR_PROJECT_TOKEN_HERE
   ```

   Commit the change directly to `main`.

4. **(Only if you picked a different repository name.)**  
   Open `config/router.yml` and change `base_url` to `/<your-repo-name>/` (keep the slashes at both ends). See [Setting the base URL](#setting-the-base-url) below.

5. **Wait for the deploy.**  
   After each commit, the **Actions** tab shows the running workflow. When it finishes, your site is live at:

   ```
   https://<your-user>.github.io/<your-repo>/
   ```

From then on, edit any file (configuration, markdown pages, images in `public/`, …) from the GitHub interface and each commit re-deploys the site.

### Setting the base URL

Your site needs to know the URL path where it will be published. This is controlled by the `base_url` option in `config/router.yml`.

- If your repository is named **`taxonpages`**, the default works as-is — you don't need to change anything.
- If your repository has a **different name** (for example, `my-lab-site`), open `config/router.yml` and change the `base_url` value to `/my-lab-site/` (keep the slashes on both sides).
- If you are using a **custom domain** (you added a `CNAME` file under `public/`), or your repository is named `<your-user>.github.io`, set `base_url: /`.

If the `base_url` doesn't match the actual site address, images, links, and styles will not load.

## Project structure

| Path                 | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `config/`            | YAML configuration files (API, header, metadata, style, maps, …)   |
| `config/style/`      | Theme and style overrides (CSS custom properties)                  |
| `config/vendor/`     | Third-party assets referenced from configuration                   |
| `pages/`             | Markdown (and Vue) content pages — the file name becomes the route |
| `public/`            | Static assets served as-is (images, `CNAME`, …)                    |
| `.github/workflows/` | GitHub Actions workflow that builds and deploys the site           |
| `package.json`       | Declares `@sfgrp/taxonpages` and exposes the `taxonpages` CLI      |

### Optional configuration files

Several configuration files ship as `*.yml.example`. To activate any of them, rename the file (remove the `.example` suffix) and edit its contents. On GitHub you can do this with **Edit → Rename**; locally, with `cp` or `mv`:

```
cp config/analytics.yml.example config/analytics.yml
cp config/news.yml.example      config/news.yml
cp config/taxa_page.yml.example config/taxa_page.yml
cp config/tracker.yml.example   config/tracker.yml
```

See the [User Guide](https://github.com/SpeciesFileGroup/taxonpages/blob/package/docs/user-guide.md) for the full reference of every option.

## Local development

If you prefer to preview your changes on your own computer before committing, or to develop custom panels and modules, you can run TaxonPages locally.

1. Clone your repository and install dependencies:

   ```
   git clone https://github.com/<your-user>/<your-repo>.git
   cd <your-repo>
   npm install
   ```

2. Make sure `config/api.yml` has your TaxonWorks URL and project token.

3. Start the development server:

   ```
   npm run dev
   ```

   The site will be available at http://localhost:5173/

### Setup wizard

If you prefer a visual interface over editing YAML files by hand, run:

```
npm run setup
```

This opens a web-based wizard at http://localhost:4400/ where you can configure the TaxonWorks connection, pick which panels and modules are enabled, customize the theme, and edit other settings. Your changes are written back to the files in `config/`, ready to be committed.

### npm scripts

| Script              | Description                                      |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Start the SPA development server (port 5173)     |
| `npm run dev:ssr`   | Start the SSR development server (port 6173)     |
| `npm run build`     | Build the site for production (SPA mode)         |
| `npm run build:ssr` | Build the site for production (SSR mode)         |
| `npm run serve`     | Start the production SSR server (port 6173)      |
| `npm run preview`   | Preview the production build locally (port 4173) |
| `npm run setup`     | Launch the web-based configuration interface     |

For the full list of CLI commands (including `taxonpages package add/remove/list`, `taxonpages update`, etc.), see the main [TaxonPages README](https://github.com/SpeciesFileGroup/taxonpages/tree/package#cli-commands).

## Extending your site

TaxonPages can be extended with **panels** (UI blocks on taxon pages), **modules** (new routes/pages), and **plugins** (build, server, or Vue-app hooks). You can write them locally inside your project or install them from NPM.

- Install a published package:

  ```
  npx taxonpages package add <package-name>
  ```

- Create local panels in a `panels/` folder and local modules in a `modules/` folder at the project root. Local extensions take precedence over NPM packages and core.

For full instructions, see the [Developer Guide](https://github.com/SpeciesFileGroup/taxonpages/blob/package/docs/developer-guide.md).

## Keeping TaxonPages up to date

The deploy workflow installs the latest release of `@sfgrp/taxonpages` on every build, so your deployed site is always up to date automatically.

For local development, upgrade with:

```
npm update @sfgrp/taxonpages
```

or use the CLI helper:

```
npx taxonpages update
```

## Documentation

- [TaxonPages repository](https://github.com/SpeciesFileGroup/taxonpages/tree/package)
- [User Guide](https://github.com/SpeciesFileGroup/taxonpages/blob/package/docs/user-guide.md) — pages, theme, analytics, layout, taxa page panels, installing extensions
- [Developer Guide](https://github.com/SpeciesFileGroup/taxonpages/blob/package/docs/developer-guide.md) — authoring and publishing panels, modules, and plugins

## License

Released under the MIT License. See [LICENSE](LICENSE) for details.
