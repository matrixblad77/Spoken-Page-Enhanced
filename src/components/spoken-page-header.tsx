"use client";

/*
 * [Spoken Page Enhanced v1.3.15] PUBLIC BRANDING HEADER
 * ----------------------------------------------------
 * Custom product identity for the Enhanced project.
 * Original base: Spoken Page v1.3.0
 * Custom release: v1.3.15
 * This file intentionally contains no machine-specific paths or configuration.
 */

import Image from "next/image";

export function SpokenPageHeader() {
  return (
    <header className="page-header enhanced-page-header" aria-label="Spoken Page Enhanced">
      <div className="page-header-shell">
        <div className="page-header-brand">
          <div className="page-header-logo">
            <Image
              alt="Spoken Page Enhanced logo"
              className="page-header-logo-image"
              height={132}
              priority
              src="/spoken-page-logo-trimmed.png"
              width={176}
            />
          </div>
          <div className="page-header-copy">
            <div className="page-header-title-block">
              <div className="page-header-title-row enhanced-page-title">
                <h1>
                  Spoken Page <span className="enhanced-word">Enhanced</span>
                </h1>
                <span className="app-version">v1.3.15</span>
              </div>
              <p>Subtitle-ready listening synced with Audiobookshelf</p>
              <p className="enhanced-origin">
                Based on original Spoken Page v1.3.0 · {" "}
                <a
                  className="enhanced-original-github"
                  href="https://github.com/JCDeSantis/spoken-page"
                  rel="noreferrer"
                  target="_blank"
                >
                  Original GitHub
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default SpokenPageHeader;
