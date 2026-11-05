# ZeroFee: the commands a newcomer (or an AI reviewer) needs. Each target is one line you can also run by hand.
.PHONY: help install dev test typecheck build verify selfhost contract

help:          ## List the targets
	@grep -E '^[a-z]+:.*## ' Makefile | sed 's/:.*## /\t/'

install:       ## Install the exact dependencies (no install scripts)
	npm ci --ignore-scripts

dev: install   ## Run the app on sample money: open http://localhost:5180/?demo
	npm run -w @zerofee/web dev

test:          ## Every unit and property test (no network)
	npm test

typecheck:     ## TypeScript check of the app (apps/web; the Chrome extension is not ready and not checked)
	npm run typecheck

build:         ## Build the web app into apps/web/dist
	npm run -w @zerofee/web build

verify: install typecheck test build  ## Everything CI runs, from a fresh clone

selfhost:      ## Build and serve the app with its relay on http://localhost:5180 (keys optional, from .env)
	bash tools/selfhost/run.sh

contract:      ## The NEAR contract's tests (needs Rust, see README)
	npm run test:contract
