class RentalApplication {
    constructor() {
        // Scope draft key to propertyId — prevents drafts from bleeding across different listings.
        const _pid = new URLSearchParams(window.location.search).get('propertyId') || 'generic';
        this.config = {
            LOCAL_STORAGE_KEY: `choicePropertiesRentalApp_${_pid}`,
            AUTO_SAVE_INTERVAL: 30000,
            MAX_FILE_SIZE: 10 * 1024 * 1024
        };
        
        this.state = {
            currentSection: 1,
            isSubmitting: false,
            isOnline: true,
            lastSave: null,
            applicationId: null,
            formData: {},
            language: 'en'
        };
        
        // Smart retry properties
        this.maxRetries = 3;
        this.retryCount = 0;
        this.retryTimeout = null;

        // P1-D: Tracks whether the form has changes not yet persisted to localStorage
        this._hasUnsavedChanges = false;

        // Single source of truth for which property is currently selected.
        // Set by onPropertySelected(); read by _updateRatio, validateStep(1), and submission.
        this._selectedPropertyId = null;
        
        // config.js must be loaded before this file
        this.BACKEND_URL = CONFIG.SUPABASE_URL + '/functions/v1/process-application';
        
        this.initialize();
    }

    // ---------- Pre-fill from URL params (when linked from a property listing) ----------
    prefillFromURL() {
        const p = new URLSearchParams(window.location.search);
        // Pre-fill move-in date if passed from listing page
        const moveIn = p.get('moveIn');
        const moveInEl = document.getElementById('requestedMoveIn');
        if (moveIn && moveInEl && !moveInEl.value) moveInEl.value = moveIn;
        // Property selection is handled by loadLockedProperty() using the propertyId param
    }

    // ---------- SSN toggle ----------
    setupSSNToggle() {
        const ssnInput = document.getElementById('ssn');
        if (!ssnInput) return;
        const container = ssnInput.parentElement;
        let toggle = container.querySelector('.ssn-toggle');
        if (!toggle) {
            toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'ssn-toggle';
            toggle.id = 'ssnToggle';
            toggle.innerHTML = '<i class="fas fa-eye"></i>';
            container.appendChild(toggle);
        }
        ssnInput.type = 'password';
        toggle.addEventListener('click', () => {
            if (ssnInput.type === 'password') {
                ssnInput.type = 'text';
                toggle.innerHTML = '<i class="fas fa-eye-slash"></i>';
            } else {
                ssnInput.type = 'password';
                toggle.innerHTML = '<i class="fas fa-eye"></i>';
            }
        });
        ssnInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').substring(0, 4);
        });
    }

    // ---------- Co-applicant SSN toggle ----------
    setupCoSSNToggle() {
        const coSsnInput = document.getElementById('coSsn');
        if (!coSsnInput) return;
        const container = coSsnInput.parentElement;
        if (container.querySelector('.ssn-toggle')) return; // already exists
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ssn-toggle';
        toggle.innerHTML = '<i class="fas fa-eye"></i>';
        container.appendChild(toggle);
        coSsnInput.type = 'password';
        toggle.addEventListener('click', () => {
            if (coSsnInput.type === 'password') {
                coSsnInput.type = 'text';
                toggle.innerHTML = '<i class="fas fa-eye-slash"></i>';
            } else {
                coSsnInput.type = 'password';
                toggle.innerHTML = '<i class="fas fa-eye"></i>';
            }
        });
        coSsnInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').substring(0, 4);
        });
    }

    // ---------- Employment status conditionals ----------
    setupEmploymentConditionals() {
        const statusEl = document.getElementById('employmentStatus');
        if (!statusEl) return;
        statusEl.addEventListener('change', (e) => this._applyEmploymentLabels(e.target.value));
        // Apply on load in case of restored draft
        if (statusEl.value) this._applyEmploymentLabels(statusEl.value);
    }

    // Shared helper — called by both setupEmploymentConditionals and applyTranslations
    _applyEmploymentLabels(status) {
        const EMPLOYED_STATUSES = ['Full-time', 'Part-time', 'Self-employed'];
        const isEmployed = EMPLOYED_STATUSES.includes(status);

        const employedGroup = document.getElementById('employedFieldsGroup');
        const altGroup      = document.getElementById('altIncomeSourceGroup');
        const employerInput = document.getElementById('employer');
        const employerLbl   = document.getElementById('employerLabel');
        const incomeLabel   = document.querySelector('label[for="monthlyIncome"]');

        // Toggle employed-only fields
        if (employedGroup) {
            employedGroup.style.display = isEmployed ? '' : 'none';
            employedGroup.querySelectorAll('input, select').forEach(el => {
                if (isEmployed) {
                    el.setAttribute('required', '');
                } else {
                    el.removeAttribute('required');
                    this.clearError(el);
                    el.classList.remove('is-invalid', 'is-valid');
                }
            });
        }

        // Employer field label and required
        if (employerInput && employerLbl) {
            const labelKey = isEmployed ? 'employerLabel' : `employerLabel_${status}`;
            const labelText = this.t(labelKey);
            employerLbl.childNodes[0].textContent = labelText + ' ';
            if (isEmployed) {
                employerInput.setAttribute('required', '');
                employerInput.placeholder = '';
            } else {
                employerInput.removeAttribute('required');
                employerInput.placeholder = this.t('errRequired') === 'Obligatorio' ? 'Opcional' : 'Optional';
                this.clearError(employerInput);
                employerInput.classList.remove('is-invalid');
            }
        }

        // Alt income source group for non-employed
        if (altGroup) {
            altGroup.style.display = isEmployed ? 'none' : '';
            // Update its label and placeholder in current language
            const lbl = altGroup.querySelector('label');
            if (lbl) lbl.childNodes[0].textContent = this.t('altIncomeSourceLabel') + ' ';
            const inp = altGroup.querySelector('input');
            if (inp) inp.placeholder = this.t('altIncomeSourcePlaceholder');
        }

        // Income label relabel by status
        if (incomeLabel) {
            const labelKey = `incomeLabel_${status}`;
            const labelText = this.t(labelKey);
            // Only update if we got a real translated variant (not the key itself as fallback)
            if (labelText !== labelKey) {
                incomeLabel.childNodes[0].textContent = labelText + ' ';
            } else {
                incomeLabel.childNodes[0].textContent = this.t('monthlyIncomeLabel') + ' ';
            }
        }
    }

    // ---------- Prior residence conditional (2.1) ----------
    // Show the prior residence section when "How long at this address?" suggests < 2 years.
    setupPriorResidenceConditional() {
        const input = document.getElementById('residencyStart');
        const group = document.getElementById('priorResidenceGroup');
        if (!input || !group) return;
        const check = () => {
            group.style.display = this._isUnderTwoYears(input.value) ? '' : 'none';
        };
        input.addEventListener('input', check);
        input.addEventListener('change', check);
        check(); // Apply on load (restored draft)
    }

    _isUnderTwoYears(text) {
        const t = (text || '').toLowerCase().trim();
        if (!t) return false;
        // Month-only pattern: "6 months", "18 months" (no year)
        const moOnly = t.match(/^(\d+)\s*month/);
        if (moOnly) return parseInt(moOnly[1]) < 24;
        // Year pattern: "1 year", "1.5 years"
        const yrMatch = t.match(/(\d+\.?\d*)\s*year/);
        if (yrMatch) return parseFloat(yrMatch[1]) < 2;
        // Common phrase cues
        if (/less than|under 2|just moved|recently moved|new(ly)?/.test(t)) return true;
        return false;
    }

    // ---------- Co-applicant employment status conditional (2.8) ----------
    setupCoEmploymentConditionals() {
        const statusEl = document.getElementById('coEmploymentStatus');
        if (!statusEl) return;
        const EMPLOYED = ['Full-time', 'Part-time', 'Self-employed'];
        const toggle = (val) => {
            const group = document.getElementById('coEmployedFieldsGroup');
            if (!group) return;
            group.style.display = EMPLOYED.includes(val) ? '' : 'none';
        };
        statusEl.addEventListener('change', e => toggle(e.target.value));
        toggle(statusEl.value); // Apply on load
    }

    // ---------- Eviction / Bankruptcy / Criminal explain boxes ----------
    setupEvictionExplain() {
        const makeToggle = (radioName, groupId) => {
            const radios = document.querySelectorAll(`input[name="${radioName}"]`);
            const group  = document.getElementById(groupId);
            if (!group) return;
            radios.forEach(r => r.addEventListener('change', (e) => {
                group.style.display = e.target.value === 'Yes' ? '' : 'none';
            }));
        };
        makeToggle('Ever Evicted',       'evictionExplainGroup');
        makeToggle('Has Bankruptcy',     'bankruptcyExplainGroup');
        makeToggle('Has Criminal History', 'criminalExplainGroup');
    }

    // ---------- Phone auto-formatting ----------
    setupPhoneFormatting() {
        const phoneFields = document.querySelectorAll('input[type="tel"]');
        phoneFields.forEach(input => {
            input.addEventListener('input', (e) => {
                const digits = e.target.value.replace(/\D/g, '').substring(0, 10);
                let formatted = digits;
                if (digits.length >= 7) {
                    formatted = `(${digits.substring(0,3)}) ${digits.substring(3,6)}-${digits.substring(6)}`;
                } else if (digits.length >= 4) {
                    formatted = `(${digits.substring(0,3)}) ${digits.substring(3)}`;
                } else if (digits.length > 0) {
                    formatted = `(${digits}`;
                }
                e.target.value = formatted;
            });
        });
    }

    // ---------- Income currency formatting ----------
    setupIncomeFormatting() {
        const incomeFields = ['monthlyIncome', 'otherIncome', 'coMonthlyIncome', 'rentAmount'];
        incomeFields.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('blur', (e) => {
                const raw = e.target.value.replace(/[^0-9.]/g, '');
                if (!raw) return;
                const num = parseFloat(raw);
                if (!isNaN(num)) {
                    e.target.value = '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                }
            });
            el.addEventListener('focus', (e) => {
                e.target.value = e.target.value.replace(/[^0-9.]/g, '');
            });
        });
    }

    // ---------- Load active properties into dropdown ----------
    async loadPropertyDropdown() {
        const select = document.getElementById('propertySelect');
        if (!select) return;
        try {
            const { data: props, error } = await window.CP.sb()
                .from('properties')
                .select('id, title, address, city, state, zip, monthly_rent, application_fee, bedrooms, bathrooms, available_date')
                .eq('status', 'active')
                .order('created_at', { ascending: false });

            select.innerHTML = '<option value="">— Select a property —</option>';

            if (error || !props || props.length === 0) {
                select.innerHTML = '<option value="">No properties currently available</option>';
                return;
            }

            // Store properties for fee lookup
            this._properties = {};
            props.forEach(p => {
                this._properties[p.id] = p;
                const beds  = p.bedrooms  ? `${p.bedrooms}bd` : '';
                const baths = p.bathrooms ? `${p.bathrooms}ba` : '';
                const rent  = p.monthly_rent ? ` · $${parseInt(p.monthly_rent).toLocaleString()}/mo` : '';
                const label = `${p.title} — ${p.address}, ${p.city}, ${p.state}${rent}${beds||baths ? ' · ' + [beds,baths].filter(Boolean).join('/') : ''}`;
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = label;
                select.appendChild(opt);
            });

            // Listen for selection changes (onchange prevents duplicate listeners on re-call)
            select.onchange = (e) => this.onPropertySelected(e.target.value);

        } catch (err) {
            select.innerHTML = '<option value="">Unable to load properties — please refresh</option>';
        }
    }

    // ---------- Section 1 Next button helpers ----------
    // The Next button for step 1 is disabled at page load and only enabled once
    // a property is confirmed selected (locked or chosen from the dropdown).
    _getSection1NextBtn() {
        return document.querySelector('#section1 .btn-next');
    }
    _enableSection1Next() {
        const btn = this._getSection1NextBtn();
        if (!btn) return;
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor  = '';
        btn.title = '';
    }
    _disableSection1Next(reason) {
        const btn = this._getSection1NextBtn();
        if (!btn) return;
        btn.disabled = true;
        btn.style.opacity = '0.55';
        btn.style.cursor  = 'not-allowed';
        btn.title = reason || '';
    }

    // ---------- Build a property object instantly from URL params ----------
    // Produces a lightweight prop object so the locked card can render immediately,
    // before the Supabase round-trip completes. The _formattedAddress field holds
    // the pre-formatted address string from the URL, avoiding lossy re-parsing.
    _buildPropertyFromURLParams(id) {
        const p = new URLSearchParams(window.location.search);
        return {
            id,
            _formattedAddress: p.get('propertyAddress') || '',
            address:           p.get('propertyAddress') || '',
            city:              '',
            state:             '',
            zip:               '',
            title:             p.get('title')  || 'Selected Property',
            monthly_rent:      parseFloat(p.get('rent')) || null,
            application_fee:   parseFloat(p.get('fee'))  || 0,
            available_date:    p.get('moveIn') || null,
            bedrooms:          null,
            bathrooms:         null,
        };
    }

    // ---------- Background Supabase verify + data refresh ----------
    // Called after the locked card is already showing (built from URL params).
    // Fetches the live property record to confirm it is still active and to enrich
    // the stored prop with fields the URL does not carry (beds, baths, lease terms…).
    async _verifyAndRefreshProperty(propertyId) {
        try {
            const { data: prop, error } = await window.CP.sb()
                .from('properties')
                .select(`
                    id, title, address, city, state, zip,
                    monthly_rent, application_fee,
                    bedrooms, bathrooms, available_date,
                    pets_allowed, smoking_allowed,
                    pet_types_allowed, pet_weight_limit,
                    lease_terms, minimum_lease_months
                `)
                .eq('id', propertyId)
                .eq('status', 'active')
                .single();

            if (error || !prop) {
                this._showPropertyUnavailableInCard();
                return;
            }

            // Enrich stored record with live data (adds beds/baths, lease terms, etc.)
            this._properties[propertyId] = prop;

            // Persist fresh full context to sessionStorage for success page and other views
            sessionStorage.setItem('cp_property_context', JSON.stringify({
                id:               prop.id,
                title:            prop.title,
                address:          prop.address,
                city:             prop.city,
                state:            prop.state,
                zip:              prop.zip              || '',
                monthly_rent:     prop.monthly_rent     || null,
                application_fee:  prop.application_fee  || 0,
                available_date:   prop.available_date   || null,
                bedrooms:         prop.bedrooms         || null,
                bathrooms:        prop.bathrooms        || null,
            }));

            // Refresh locked card meta and banners with the now-complete live data
            this._activatePropertyLock(propertyId);
            this.onPropertySelected(propertyId);

        } catch (err) {
            // Silent — URL-param data is sufficient for the form to work offline or
            // when Supabase is temporarily unreachable.
        }
    }

    // ---------- Show unavailable notice inside the locked card ----------
    _showPropertyUnavailableInCard() {
        const card    = document.getElementById('propertyLockedCard');
        const titleEl = document.getElementById('lockedCardTitle');
        const metaEl  = document.getElementById('lockedCardMeta');
        if (card) {
            card.style.background   = '#fef2f2';
            card.style.borderColor  = '#fca5a5';
        }
        if (titleEl) titleEl.textContent = 'This property is no longer available';
        if (metaEl)  metaEl.textContent  = 'The listing may have been rented or removed. Please choose another property.';
        this._disableSection1Next('This property is no longer available — please go back and choose another.');
    }

    // ---------- Property load — handles both linked and direct visits ----------
    // Two-phase approach:
    //   Phase 1 (instant) — build the locked card from URL params so there is zero
    //                        perceived latency for users arriving from a listing page.
    //   Phase 2 (background) — fetch the live Supabase record to verify the property
    //                          is still active and to enrich with beds/baths/lease terms.
    // If there is no propertyId in the URL the full property dropdown is shown instead.
    async loadLockedProperty() {
        const propertyId = new URLSearchParams(window.location.search).get('propertyId');

        if (!propertyId) {
            // No property in URL — open dropdown for free selection
            const group = document.getElementById('propertySelectGroup');
            if (group) group.style.display = '';
            await this.loadPropertyDropdown();
            return;
        }

        // ── Phase 1: instant locked card from URL params ─────────────────────
        const urlProp = this._buildPropertyFromURLParams(propertyId);
        this._properties = { [propertyId]: urlProp };

        // Set select value and remove `required` before calling onPropertySelected
        // so _updateRatio reads the correct ID and the hidden select never triggers
        // unwanted browser or custom validation while the locked card is showing.
        const selectEl = document.getElementById('propertySelect');
        if (selectEl) {
            selectEl.value = propertyId;
            selectEl.removeAttribute('required');
        }

        this.onPropertySelected(propertyId);   // sets _selectedPropertyId, fills fields, enables Next
        this._activatePropertyLock(propertyId); // swaps dropdown → locked card

        // ── Phase 2: background verify + data refresh (non-blocking) ─────────
        this._verifyAndRefreshProperty(propertyId);
    }

    // ---------- Invalid property message — shown when the URL carries no valid propertyId ----------
    _showInvalidPropertyMessage() {
        const form = document.getElementById('rentalApplication');
        if (form) form.style.display = 'none';

        const container = document.querySelector('.container');
        if (!container) return;

        const msg = document.createElement('div');
        msg.style.cssText = 'text-align:center;padding:60px 24px;';
        msg.innerHTML = `
            <div style="font-size:48px;margin-bottom:16px;line-height:1;">&#128279;</div>
            <h2 style="font-size:1.4rem;color:#1a2233;margin-bottom:10px;">This link is no longer valid</h2>
            <p style="color:#6b7280;font-size:.95rem;max-width:420px;margin:0 auto 28px;line-height:1.6;">
                The property listing you followed may have been removed, is no longer active, or this link has expired.
                Please return to the listings page to find an available property.
            </p>
            <a href="/index.html" style="display:inline-block;background:#0f1117;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:.9rem;font-weight:600;letter-spacing:.02em;">
                &#8592; View All Listings
            </a>
        `;
        container.appendChild(msg);
    }

    // ---------- Handle property selection — fill hidden fields + show fee ----------
    onPropertySelected(propertyId) {
        const prop = this._properties && this._properties[propertyId];

        // Single source of truth — everything that needs the selected property ID
        // should read this._selectedPropertyId rather than querying the DOM.
        this._selectedPropertyId = propertyId || null;

        // Reflect selection state in the section 1 Next button
        if (propertyId) {
            this._enableSection1Next();
        } else {
            this._disableSection1Next();
        }

        // Update hidden address field used by form submission.
        // Prefer _formattedAddress (pre-built from URL params) over re-formatting
        // individual components to avoid trailing ", , " when city/state are blank.
        const addrField = document.getElementById('propertyAddress');
        if (addrField) {
            addrField.value = prop
                ? (prop._formattedAddress || `${prop.address}, ${prop.city}, ${prop.state} ${prop.zip || ''}`.trim())
                : '';
        }

        // Update fee hidden field
        const feeField = document.getElementById('selectedPropertyFee');
        const fee = prop ? (parseInt(prop.application_fee) || 0) : 0;
        if (feeField) feeField.value = fee;

        // Update fee bar above move-in date
        const feeBar = document.getElementById('propertyFeeBar');
        if (feeBar) {
            if (prop) {
                document.getElementById('feeBarAmount').textContent = fee === 0 ? 'Free' : `$${fee}`;
                document.getElementById('feeBarTitle').textContent  = fee === 0 ? 'No application fee for this property' : `Application Fee: $${fee}`;
                document.getElementById('feeBarDesc').textContent   = fee === 0 ? 'This property has no application fee.' : 'Our team will contact you to arrange payment after submission.';
                feeBar.style.display = 'flex';
            } else {
                feeBar.style.display = 'none';
            }
        }

        // Update fee display in step 6 review
        const feeAmountEl  = document.getElementById('feeAmountDisplay');
        const feeTitleEl   = document.getElementById('feeTitleText');
        const feeDisplayEl = document.getElementById('feeDisplay');
        const reminderEl   = document.getElementById('paymentReminder');
        if (feeAmountEl)  feeAmountEl.textContent  = fee === 0 ? 'Free' : `$${fee}`;
        if (feeTitleEl)   feeTitleEl.textContent   = fee === 0 ? 'No Application Fee' : `Application Fee: $${fee}.00`;
        if (feeDisplayEl) feeDisplayEl.style.display = fee === 0 ? 'none' : '';
        if (reminderEl)   reminderEl.style.display   = fee === 0 ? 'none' : '';

        // Update property confirm banner
        const banner = document.getElementById('propertyConfirmBanner');
        if (banner && prop) {
            document.getElementById('pcbTitle').textContent = prop.title;
            const metaParts = [];
            const displayAddr = prop._formattedAddress || [prop.address, prop.city, prop.state].filter(Boolean).join(', ');
            metaParts.push(`<i class="fas fa-map-marker-alt" style="margin-right:4px;color:#c9a84c"></i>${displayAddr}`);
            if (prop.monthly_rent) metaParts.push(`<strong>$${parseInt(prop.monthly_rent).toLocaleString()}/mo</strong>`);
            if (prop.bedrooms || prop.bathrooms) metaParts.push(`${prop.bedrooms||'?'}bd / ${prop.bathrooms||'?'}ba`);
            document.getElementById('pcbMeta').innerHTML = metaParts.join(' &nbsp;·&nbsp; ');
            banner.style.display = 'flex';
        } else if (banner) {
            banner.style.display = 'none';
        }

        // Keep sessionStorage in sync so the success page always shows the correct
        // property context — covers the dropdown path, the escape-hatch + re-select
        // path, and the locked-arrival path (harmless double-write).
        if (prop) {
            sessionStorage.setItem('cp_property_context', JSON.stringify({
                id:              prop.id,
                title:           prop.title,
                address:         prop.address,
                city:            prop.city,
                state:           prop.state,
                zip:             prop.zip             || '',
                monthly_rent:    prop.monthly_rent    || null,
                application_fee: prop.application_fee || 0,
                available_date:  prop.available_date  || null,
                bedrooms:        prop.bedrooms        || null,
                bathrooms:       prop.bathrooms       || null,
            }));
        } else {
            sessionStorage.removeItem('cp_property_context');
        }

        this._showContextBanner(prop);

        // Recalculate income-to-rent ratio now that a property is known
        if (typeof this._updateRatio === 'function') this._updateRatio();
    }

    // ---------- Lock property selection when arriving from a listing ----------
    // Called only when all three conditions are met (see loadPropertyDropdown).
    // Hides the dropdown and shows a locked property card in its place.
    // The escape hatch restores the dropdown if the user needs to change property.
    _activatePropertyLock(propertyId) {
        const prop  = this._properties && this._properties[propertyId];
        const group = document.getElementById('propertySelectGroup');
        const card  = document.getElementById('propertyLockedCard');
        if (!prop || !group || !card) return;

        // Build the detail line shown beneath the property title.
        // Use _formattedAddress (pre-built from URL params) when available so the card
        // renders correctly even before the Supabase verify fetch returns.
        const rent  = prop.monthly_rent ? `$${parseInt(prop.monthly_rent).toLocaleString()}/mo` : '';
        const beds  = prop.bedrooms     ? `${prop.bedrooms} bed`  : '';
        const baths = prop.bathrooms    ? `${prop.bathrooms} bath` : '';
        const addr  = prop._formattedAddress || [prop.address, prop.city, prop.state].filter(Boolean).join(', ');
        const meta  = [addr, rent, [beds, baths].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');

        document.getElementById('lockedCardTitle').textContent = prop.title;
        document.getElementById('lockedCardMeta').textContent  = meta;

        // Swap: hide dropdown group, show locked card
        group.style.display = 'none';
        card.style.display  = 'flex';

        // Keep the hidden select in sync. `required` has already been removed by
        // loadLockedProperty so it does not trigger browser or custom validation
        // while the locked card is visible.
        const select = document.getElementById('propertySelect');
        if (select) select.value = propertyId;

        // Escape hatch — clicking "Not this property?" restores the open dropdown.
        // Restore `required` on the select so the open-dropdown flow validates normally.
        const escapeBtn = document.getElementById('propertyLockEscape');
        if (escapeBtn) {
            escapeBtn.style.display = '';
            escapeBtn.onclick = async () => {
                card.style.display  = 'none';
                group.style.display = '';
                const sel = document.getElementById('propertySelect');
                if (sel) {
                    sel.value = '';
                    sel.setAttribute('required', '');
                }
                this.onPropertySelected('');   // clears _selectedPropertyId, disables Next
                await this.loadPropertyDropdown();
            };
        }

        this._showContextBanner(prop);
    }

    // ---------- Persistent property context banner (above all steps) ----------
    _showContextBanner(prop) {
        const banner = document.getElementById('propertyContextBanner');
        if (!banner) return;
        if (!prop) { this._hideContextBanner(); return; }
        document.getElementById('pcbContextTitle').textContent = prop.title;
        const metaParts = [];
        const displayAddr = prop._formattedAddress || [prop.address, prop.city, prop.state].filter(Boolean).join(', ');
        metaParts.push(`<i class="fas fa-map-marker-alt" style="margin-right:4px;color:#c9a84c"></i>${displayAddr}`);
        if (prop.monthly_rent) metaParts.push(`<strong>$${parseInt(prop.monthly_rent).toLocaleString()}/mo</strong>`);
        if (prop.bedrooms || prop.bathrooms) metaParts.push(`${prop.bedrooms||'?'}bd / ${prop.bathrooms||'?'}ba`);
        document.getElementById('pcbContextMeta').innerHTML = metaParts.join(' &nbsp;·&nbsp; ');
        banner.style.display = 'flex';
    }

    _hideContextBanner() {
        const banner = document.getElementById('propertyContextBanner');
        if (banner) banner.style.display = 'none';
    }

    // ---------- Test fill visibility — localhost only ----------
    setupTestFillVisibility() {
        const container = document.getElementById('testButtonContainer');
        if (container && CONFIG.isLocalhost) {
            container.style.display = 'block';
        }
    }

    // ---------- Event listeners ----------
    setupEventListeners() {
        document.addEventListener('click', (e) => {
            if (e.target.matches('.btn-next') || e.target.closest('.btn-next')) {
                const section = this.getCurrentSection();
                this.nextSection(section);
            }
            if (e.target.matches('.btn-prev') || e.target.closest('.btn-prev')) {
                const section = this.getCurrentSection();
                this.previousSection(section);
            }
        });
        // P1-D: Track unsaved changes flag and auto-save
        document.addEventListener('input', (e) => {
            // Don't flag SSN fields as "unsaved changes" to avoid privacy-related prompts
            if (e.target && (e.target.id === 'ssn' || e.target.id === 'coSsn')) return;
            this._hasUnsavedChanges = true;
            this.debouncedSave();
        });
        // P1-D: beforeunload warning when unsaved changes exist
        window.addEventListener('beforeunload', (e) => {
            if (this._hasUnsavedChanges && !this.state.isSubmitting) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });
        const form = document.getElementById('rentalApplication');
        if (form) {
            form.addEventListener('submit', (e) => {
                this.handleFormSubmit(e);
            });
        }
    }

    // P1-D: debounced save helper (created once, reused)
    get debouncedSave() {
        if (!this._debouncedSave) {
            this._debouncedSave = this.debounce(() => this.saveProgress(), 1000);
        }
        return this._debouncedSave;
    }

    // ---------- Initialization ----------
    initialize() {
        // Language must be initialized first — all other methods depend on this.t()
        this.setupLanguageToggle();
        this.setupEventListeners();
        this.setupOfflineDetection();
        this.setupRealTimeValidation();
        this.setupSSNToggle();
        this.setupCoSSNToggle();
        this.setupFileUploads();
        this.setupConditionalFields();
        this.applyFeatureFlags();
        this.setupEmploymentConditionals();
        this.setupCoEmploymentConditionals();
        this.setupEvictionExplain();
        this.setupPriorResidenceConditional();
        this.setupCharacterCounters();
        this.restoreSavedProgress();
        this.setupGeoapify();
        this.setupInputFormatting();
        this.setupPhoneFormatting();
        this.setupIncomeFormatting();
        this.prefillFromURL();
        // Disable the section 1 Next button until a property is confirmed.
        // loadLockedProperty (or a dropdown selection) will call onPropertySelected
        // which re-enables it. This closes the window where a user could click Next
        // before the property card or dropdown has finished loading.
        this._disableSection1Next('Loading property details…');
        this.loadLockedProperty();
        this.setupTestFillVisibility();
        
        // If returning after a submit (e.g. back button), session has appId — just redirect properly
        const savedAppId = sessionStorage.getItem('lastSuccessAppId');
        if (savedAppId) {
            sessionStorage.removeItem('lastSuccessAppId');
            window.location.href = `/apply/success.html?appId=${encodeURIComponent(savedAppId)}`;
        }
    }

    // ---------- Offline detection ----------
    setupOfflineDetection() {
        window.addEventListener('online', () => {
            this.setState({ isOnline: true });
        });
        window.addEventListener('offline', () => {
            this.setState({ isOnline: false });
        });
        this.setState({ isOnline: navigator.onLine });
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.updateUIState();
    }

    updateUIState() {
        const offlineIndicator = document.getElementById('offlineIndicator');
        if (offlineIndicator) {
            offlineIndicator.style.display = this.state.isOnline ? 'none' : 'block';
        }
        const submitBtn = document.getElementById('mainSubmitBtn');
        if (submitBtn) {
            submitBtn.disabled = !this.state.isOnline;
            submitBtn.title = this.state.isOnline ? '' : 'You are offline';
        }
    }

    // ---------- Geoapify (unchanged) ----------
    setupGeoapify() {
        const apiKey = (window.CONFIG?.GEOAPIFY_API_KEY) || '';
        // Silently skip autocomplete if no API key is configured
        if (!apiKey || apiKey.includes('YOUR_')) return;
        const fields = ['propertyAddress', 'currentAddress'];
        fields.forEach(id => {
            const input = document.getElementById(id);
            if (!input) return;
            const container = document.createElement('div');
            container.style.position = 'relative';
            input.parentNode.insertBefore(container, input);
            container.appendChild(input);
            const dropdown = document.createElement('div');
            dropdown.className = 'autocomplete-dropdown';
            dropdown.style.cssText = 'position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; z-index: 1000; display: none; max-height: 200px; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border-radius: 4px;';
            container.appendChild(dropdown);
            input.addEventListener('input', this.debounce(async (e) => {
                const text = e.target.value;
                if (text.length < 3) {
                    dropdown.style.display = 'none';
                    return;
                }
                try {
                    const response = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&apiKey=${apiKey}`);
                    const data = await response.json();
                    if (data.features && data.features.length > 0) {
                        dropdown.innerHTML = '';
                        data.features.forEach(feature => {
                            const item = document.createElement('div');
                            item.style.cssText = 'padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 14px;';
                            item.textContent = feature.properties.formatted;
                            item.addEventListener('mouseover', () => item.style.background = '#f0f7ff');
                            item.addEventListener('mouseout', () => item.style.background = 'white');
                            item.addEventListener('click', () => {
                                input.value = feature.properties.formatted;
                                dropdown.style.display = 'none';
                                this.saveProgress();
                            });
                            dropdown.appendChild(item);
                        });
                        dropdown.style.display = 'block';
                    } else {
                        dropdown.style.display = 'none';
                    }
                } catch (err) {
                    console.error('Geocoding error:', err);
                }
            }, 300));
            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) dropdown.style.display = 'none';
            });
        });
    }

    // ---------- Input formatting (phone, SSN) ----------
    setupInputFormatting() {
        const phoneFields = ['phone', 'landlordPhone', 'supervisorPhone', 'ref1Phone', 'ref2Phone', 'emergencyPhone', 'coPhone'];
        phoneFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    let x = e.target.value.replace(/\D/g, '').match(/(\d{0,3})(\d{0,3})(\d{0,4})/);
                    e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? '-' + x[3] : '');
                });
            }
        });
        const ssnEl = document.getElementById('ssn');
        if (ssnEl) {
            ssnEl.addEventListener('input', (e) => {
                let val = e.target.value.replace(/\D/g, '');
                if (val.length > 4) val = val.substring(0, 4);
                e.target.value = val;
                if (val.length === 4) this.clearError(ssnEl);
            });
            ssnEl.addEventListener('blur', () => this.validateField(ssnEl));
        }
        const coSsnEl = document.getElementById('coSsn');
        if (coSsnEl) {
            coSsnEl.addEventListener('input', (e) => {
                let val = e.target.value.replace(/\D/g, '');
                if (val.length > 4) val = val.substring(0, 4);
                e.target.value = val;
                if (val.length === 4) this.clearError(coSsnEl);
            });
        }
    }

    // ---------- Real-time validation ----------
    setupRealTimeValidation() {
        const form = document.getElementById('rentalApplication');
        if (!form) return;
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.validateField(input));
            input.addEventListener('change', () => this.validateField(input));
            input.addEventListener('blur', () => this.validateField(input));
        });
    }

    // ---------- Validation logic (unchanged) ----------
    validateField(field) {
        let isValid = true;
        let errorMessage = this.t('errRequired');
        if (field.id === 'ssn' || field.id === 'coSsn') {
            const ssnVal = field.value.replace(/\D/g, '');
            if (!ssnVal) {
                isValid = false;
                errorMessage = this.t('errSSNRequired');
            } else if (ssnVal.length < 4) {
                isValid = false;
                errorMessage = this.t('errSSNLength');
            } else if (/[^0-9]/.test(field.value)) {
                isValid = false;
                errorMessage = this.t('errSSNNumbers');
            }
        } else if (field.id === 'dob' || field.id === 'coDob') {
            // Parse as local midnight to avoid UTC offset errors in US timezones
            const [by, bm, bd] = (field.value || '').split('-').map(Number);
            const birthDate = field.value ? new Date(by, bm - 1, bd) : null;
            const today = new Date();
            if (!field.value) {
                isValid = false;
                errorMessage = this.t('errDOBRequired');
            } else if (isNaN(birthDate.getTime())) {
                isValid = false;
                errorMessage = this.t('errDOBInvalid');
            } else {
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
                if (age < 18) {
                    isValid = false;
                    errorMessage = this.t('errDOBAge');
                }
            }
        } else if (field.id === 'requestedMoveIn') {
            // Parse as local midnight to avoid UTC offset errors in US timezones
            const [miy, mim, mid] = (field.value || '').split('-').map(Number);
            const moveInDate = field.value ? new Date(miy, mim - 1, mid) : null;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const minDate = new Date(today);
            minDate.setDate(minDate.getDate() + 3); // 3-day minimum buffer
            if (!field.value) {
                isValid = false;
                errorMessage = this.t('errMoveInRequired');
            } else if (moveInDate < today) {
                isValid = false;
                errorMessage = this.t('errMoveInPast');
            } else if (moveInDate < minDate) {
                isValid = false;
                errorMessage = this.t('errMoveInTooSoon');
            }
        } else if (field.hasAttribute('required')) {
            if (field.type === 'checkbox') {
                isValid = field.checked;
            } else if (!field.value.trim()) {
                isValid = false;
            }
            if (!isValid) {
                errorMessage = this.t('errRequired');
            }
        }
        if (isValid && field.value.trim()) {
            if (field.type === 'email') {
                const email = field.value.trim();
                if (!email.includes('@')) {
                    isValid = false;
                    errorMessage = this.t('errEmailSymbol');
                } else {
                    const parts = email.split('@');
                    if (!parts[1] || !parts[1].includes('.')) {
                        isValid = false;
                        errorMessage = this.t('errEmailDomain');
                    } else {
                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        isValid = emailRegex.test(email);
                        if (!isValid) {
                            errorMessage = this.t('errEmailFormat');
                        }
                    }
                }
            } else if (field.type === 'tel') {
                const phoneDigits = field.value.replace(/\D/g, '');
                isValid = phoneDigits.length >= 10;
                if (!isValid) {
                    errorMessage = this.t('errPhoneInvalid');
                }
            }
        }
        if (isValid) {
            this.clearError(field);
            field.classList.add('is-valid');
            field.classList.remove('is-invalid');
        } else {
            this.showError(field, errorMessage);
            field.classList.add('is-invalid');
            field.classList.remove('is-valid');
            field.classList.add('shake');
            setTimeout(() => field.classList.remove('shake'), 400);
        }
        return isValid;
    }

    showError(field, message) {
        field.classList.add('error');
        field.setAttribute('aria-invalid', 'true');
        const errorMsg = field.closest('.form-group')?.querySelector('.error-message');
        if (errorMsg) {
            errorMsg.textContent = message;
            errorMsg.style.display = 'block';
        }
    }

    clearError(field) {
        field.classList.remove('error');
        field.setAttribute('aria-invalid', 'false');
        const errorMsg = field.closest('.form-group')?.querySelector('.error-message');
        if (errorMsg) {
            errorMsg.style.display = 'none';
        }
    }

    // ---------- Section navigation (unchanged) ----------
    getCurrentSection() {
        const activeSection = document.querySelector('.form-section.active');
        return activeSection ? parseInt(activeSection.id.replace('section', '')) : 1;
    }

    nextSection(currentSection) {
        if (!this.validateStep(currentSection)) return;
        this.hideSection(currentSection);
        this.showSection(currentSection + 1);
        this.updateProgressBar();
        if (currentSection + 1 === 7) {
            this.generateApplicationSummary();
            // Show co-applicant SSN column if co-applicant is present
            const hasCoApp = document.getElementById('hasCoApplicant');
            const coSsnCol = document.getElementById('coSsnCol');
            if (coSsnCol) coSsnCol.style.display = (hasCoApp && hasCoApp.checked) ? '' : 'none';
        }
    }

    previousSection(currentSection) {
        if (currentSection > 1) {
            this.hideSection(currentSection);
            this.showSection(currentSection - 1);
            this.updateProgressBar();
        }
    }

    hideSection(sectionNumber) {
        const section = document.getElementById(`section${sectionNumber}`);
        if (section) section.classList.remove('active');
    }

    showSection(sectionNumber) {
        const section = document.getElementById(`section${sectionNumber}`);
        if (section) {
            section.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    updateProgressBar() {
        const currentSection = this.getCurrentSection();
        const progress = (currentSection / 7) * 100;
        const progressFill = document.getElementById('progressFill');
        if (progressFill) progressFill.style.width = `${progress}%`;
        const progressContainer = document.querySelector('.progress-container');
        if (progressContainer) progressContainer.setAttribute('aria-valuenow', String(currentSection));
        const t = this.getTranslations();
        const stepNames = [t.step1Label, t.step2Label, t.step3Label, t.step4Label, t.step5Label, t.step6Label, t.step7Label];
        const progressText = `${t.stepPrefix} ${currentSection} ${t.stepOf} 7: ${stepNames[currentSection-1]}`;
        if (progressContainer) progressContainer.setAttribute('data-progress-text', progressText);
        for (let i = 1; i <= 7; i++) {
            const step = document.getElementById(`step${i}`);
            if (step) {
                step.classList.remove('active', 'completed');
                if (i < currentSection) step.classList.add('completed');
                if (i === currentSection) step.classList.add('active');
            }
        }
    }

    // ---------- Step validation (unchanged) ----------
    validateStep(stepNumber) {
        // Step 1: enforce property selection (Option B — must select from dropdown)
        if (stepNumber === 1) {
            const lockedCard = document.getElementById('propertyLockedCard');
            const isLocked   = lockedCard && lockedCard.style.display !== 'none';
            const select = document.getElementById('propertySelect');
            const errEl  = document.getElementById('propertySelectError');
            // Only validate the dropdown when it is visible (not when the locked card is showing)
            if (!isLocked) {
                if (select && !select.value) {
                    if (errEl) errEl.style.display = 'block';
                    select.style.borderColor = '#dc2626';
                    select.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return false;
                } else if (select) {
                    if (errEl) errEl.style.display = 'none';
                    select.style.borderColor = '';
                }
            } else if (select) {
                // Locked mode — clear any previous error state on the hidden select
                if (errEl) errEl.style.display = 'none';
                select.style.borderColor = '';
            }

        }
        if (stepNumber === 6) {
            // Payment: require a primary method selected via icon grid
            const isUnique = this.validatePaymentSelections();
            if (!isUnique) {
                const grid = document.getElementById('paymentIconGrid');
                if (grid) { grid.classList.add('shake'); setTimeout(() => grid.classList.remove('shake'), 400); }
                grid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return false;
            }

            // Enforce at least one contact method
            const methodBoxes = document.querySelectorAll('input[name="Preferred Contact Method"]');
            const anyChecked = Array.from(methodBoxes).some(cb => cb.checked);
            let contactErrEl = document.getElementById('contactMethodError');
            if (!contactErrEl && methodBoxes.length > 0) {
                contactErrEl = document.createElement('div');
                contactErrEl.id = 'contactMethodError';
                contactErrEl.className = 'error-message';
                contactErrEl.style.display = 'none';
                contactErrEl.textContent = this.t('errContactMethod') || 'Please select at least one contact method.';
                methodBoxes[methodBoxes.length - 1].closest('.checkbox-group')?.after(contactErrEl);
            }
            if (!anyChecked) {
                if (contactErrEl) contactErrEl.style.display = 'block';
                methodBoxes[0]?.closest('.form-group')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return false;
            } else {
                if (contactErrEl) contactErrEl.style.display = 'none';
            }
        }
        const section = document.getElementById(`section${stepNumber}`);
        if (!section) return true;
        const inputs = section.querySelectorAll('input, select, textarea');
        let isStepValid = true;
        let firstInvalidField = null;
        inputs.forEach(input => {
            if (input.hasAttribute('required')) {
                if (!this.validateField(input)) {
                    isStepValid = false;
                    if (!firstInvalidField) firstInvalidField = input;
                }
            }
        });
        if (stepNumber === 6) {
            // Co-applicant validation (moved from old step 4)
            const hasCoApplicant = document.getElementById('hasCoApplicant');
            const coSection = document.getElementById('coApplicantSection');
            if (hasCoApplicant && hasCoApplicant.checked && coSection && coSection.style.display !== 'none') {
                const coInputs = coSection.querySelectorAll('input, select, textarea');
                coInputs.forEach(input => {
                    if (input.type === 'radio') {
                        const name = input.name;
                        const radios = coSection.querySelectorAll(`input[name="${name}"]`);
                        const checked = Array.from(radios).some(r => r.checked);
                        if (!checked) {
                            this.showError(radios[0], this.t('errRoleRequired'));
                            radios[0].classList.add('is-invalid');
                            isStepValid = false;
                            if (!firstInvalidField) firstInvalidField = radios[0];
                        } else {
                            radios.forEach(r => this.clearError(r));
                        }
                    } else if (input.type === 'checkbox') {
                        if (input.id === 'coConsent' && !input.checked) {
                            this.showError(input, this.t('errVerifyRequired'));
                            input.classList.add('is-invalid');
                            isStepValid = false;
                            if (!firstInvalidField) firstInvalidField = input;
                        } else {
                            this.clearError(input);
                        }
                    } else {
                        if (!input.value.trim()) {
                            this.showError(input, this.t('errRequired'));
                            input.classList.add('is-invalid');
                            isStepValid = false;
                            if (!firstInvalidField) firstInvalidField = input;
                        } else {
                            if (!this.validateField(input)) {
                                isStepValid = false;
                                if (!firstInvalidField) firstInvalidField = input;
                            }
                        }
                    }
                });
            }
        }
        if (!isStepValid && firstInvalidField) this.scrollToInvalidField(firstInvalidField);
        return isStepValid;
    }

    validatePaymentSelections() {
        const primaryInput = document.getElementById('primaryPayment');
        const primaryVal   = primaryInput ? primaryInput.value : '';
        const errEl        = document.getElementById('primaryPaymentError');
        if (!primaryVal) {
            if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Please select a payment method.'; }
            return false;
        }
        if (errEl) errEl.style.display = 'none';
        return true;
    }

    scrollToInvalidField(field) {
        const scrollTarget = field.closest('.form-group') || field;
        scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        field.classList.add('shake', 'highlight-field');
        setTimeout(() => field.focus(), 600);
        setTimeout(() => field.classList.remove('shake', 'highlight-field'), 2000);
    }

    // ---------- Feature flags ----------
    // Hides sections that are disabled in CONFIG.FEATURES.
    // Sections are wrapped in <div id="coApplicantFeature"> and <div id="vehicleInfoFeature">
    // in apply.html so they can be toggled without touching form logic.
    applyFeatureFlags() {
        const features = window.CONFIG?.FEATURES || {};

        // CO_APPLICANT — hides checkbox + co-applicant detail fields
        if (features.CO_APPLICANT === false) {
            const el = document.getElementById('coApplicantFeature');
            if (el) {
                el.style.display = 'none';
                // Uncheck the hidden checkbox so the section never validates as required
                const cb = document.getElementById('hasCoApplicant');
                if (cb) cb.checked = false;
            }
        }

        // VEHICLE_INFO — hides the vehicle radio buttons and details block
        if (features.VEHICLE_INFO === false) {
            const el = document.getElementById('vehicleInfoFeature');
            if (el) {
                el.style.display = 'none';
                // Default to "No" so vehicle fields never get submitted
                const noRadio = document.getElementById('vehicleNo');
                if (noRadio) noRadio.checked = true;
            }
        }

        // DOCUMENT_UPLOAD — placeholder for future file-upload section
        // (no UI element exists yet; flag is reserved for when the section is added)
    }

    // ---------- Conditional fields ----------
    setupConditionalFields() {
        // Payment icon grid wiring
        this.setupPaymentIconGrid();

        const petsRadio = document.getElementsByName('Has Pets');
        const petGroup = document.getElementById('petDetailsGroup');
        if (petsRadio && petGroup) {
            petsRadio.forEach(r => r.addEventListener('change', (e) => {
                petGroup.style.display = e.target.value === 'Yes' ? 'block' : 'none';
            }));
        }
        const hasCoApplicantCheck = document.getElementById('hasCoApplicant');
        const coApplicantSection = document.getElementById('coApplicantSection');
        if (hasCoApplicantCheck && coApplicantSection) {
            hasCoApplicantCheck.addEventListener('change', (e) => {
                coApplicantSection.style.display = e.target.checked ? 'block' : 'none';
                if (!e.target.checked) {
                    const inputs = coApplicantSection.querySelectorAll('input, select, textarea');
                    inputs.forEach(input => this.clearError(input));
                }
            });
        }
        const vehicleYes = document.getElementById('vehicleYes');
        const vehicleNo = document.getElementById('vehicleNo');
        const vehicleDetails = document.getElementById('vehicleDetailsSection');
        if (vehicleYes && vehicleNo && vehicleDetails) {
            const toggleVehicle = () => {
                vehicleDetails.style.display = vehicleYes.checked ? 'block' : 'none';
            };
            vehicleYes.addEventListener('change', toggleVehicle);
            vehicleNo.addEventListener('change', toggleVehicle);
        }

        // ── Income-to-rent ratio calculator ──────────────────────────
        const incomeInput = document.getElementById('monthlyIncome');
        const otherIncomeInput = document.getElementById('otherIncome');
        const ratioDiv   = document.getElementById('incomeRatioResult');
        const ratioEl    = document.getElementById('ratioDisplay');
        const updateRatio = () => {
            // Get rent from URL param, or fall back to the selected property's monthly rent.
            // Use this._selectedPropertyId (single source of truth) before falling back to DOM.
            const urlRent = parseFloat(new URLSearchParams(window.location.search).get('rent')) || 0;
            const selectedPropId = this._selectedPropertyId || document.getElementById('propertySelect')?.value;
            const propRent = (selectedPropId && this._properties && this._properties[selectedPropId])
                ? parseFloat(this._properties[selectedPropId].monthly_rent) || 0
                : 0;
            const rent  = urlRent || propRent;
            const income = parseFloat((incomeInput?.value || '').replace(/[^0-9.]/g, '')) || 0;
            const other  = parseFloat((otherIncomeInput?.value || '').replace(/[^0-9.]/g, '')) || 0;
            const total  = income + other;
            if (!ratioDiv || !ratioEl) return;
            if (total > 0 && rent > 0) {
                const ratio = (total / rent).toFixed(1);
                ratioEl.textContent = ratio + 'x';
                ratioDiv.style.display = 'flex';
                // Colour-code: >=3x good, 2-3x ok, <2x warning
                ratioEl.style.color = ratio >= 3 ? '#27ae60' : ratio >= 2 ? '#f39c12' : '#e74c3c';
            } else {
                ratioDiv.style.display = 'none';
            }
        };
        // Store reference so onPropertySelected() can re-trigger it when property changes
        this._updateRatio = updateRatio;
        if (incomeInput)      incomeInput.addEventListener('input', updateRatio);
        if (otherIncomeInput) otherIncomeInput.addEventListener('input', updateRatio);
        // Also recalculate when the property dropdown selection changes
        const propSelect = document.getElementById('propertySelect');
        if (propSelect) propSelect.addEventListener('change', updateRatio);
    }

    setupFileUploads() {
        const zones = [
            { zoneId: 'idUploadZone',         triggerId: 'idUploadTrigger',         inputId: 'docIdUpload',
              previewId: 'idUploadPreview',     filenameId: 'idUploadFilename',       removeId: 'idUploadRemove',     stateKey: 'docId' },
            { zoneId: 'incomeUploadZone',      triggerId: 'incomeUploadTrigger',     inputId: 'docIncomeUpload',
              previewId: 'incomeUploadPreview', filenameId: 'incomeUploadFilename',   removeId: 'incomeUploadRemove', stateKey: 'docIncome' },
            { zoneId: 'additionalUploadZone',  triggerId: 'additionalUploadTrigger', inputId: 'docAdditionalUpload',
              previewId: 'additionalUploadPreview', filenameId: 'additionalUploadFilename', removeId: 'additionalUploadRemove', stateKey: 'docAdditional' },
        ];

        if (!this._uploadedDocs) this._uploadedDocs = {};
        const MAX_SIZE = 10 * 1024 * 1024;
        const ALLOWED  = ['image/jpeg', 'image/png', 'application/pdf'];

        const processFile = (file, cfg) => {
            if (!ALLOWED.includes(file.type)) { alert('Please upload a JPG, PNG, or PDF file.'); return; }
            if (file.size > MAX_SIZE)          { alert('File exceeds 10 MB. Please upload a smaller file.'); return; }
            this._uploadedDocs[cfg.stateKey] = file;
            const fnEl      = document.getElementById(cfg.filenameId);
            const previewEl = document.getElementById(cfg.previewId);
            const contentEl = document.getElementById(cfg.triggerId);
            if (fnEl)      fnEl.textContent = file.name;
            if (previewEl) previewEl.style.display = 'flex';
            if (contentEl) contentEl.style.display = 'none';
        };

        zones.forEach(cfg => {
            const zone      = document.getElementById(cfg.zoneId);
            const trigger   = document.getElementById(cfg.triggerId);
            const input     = document.getElementById(cfg.inputId);
            const removeBtn = document.getElementById(cfg.removeId);
            if (!zone || !trigger || !input) return;

            trigger.addEventListener('click', () => input.click());
            input.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) processFile(f, cfg); });

            zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('upload-zone-drag'); });
            zone.addEventListener('dragleave', ()  => zone.classList.remove('upload-zone-drag'));
            zone.addEventListener('drop',      (e) => {
                e.preventDefault(); zone.classList.remove('upload-zone-drag');
                const f = e.dataTransfer.files[0]; if (f) processFile(f, cfg);
            });

            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    delete this._uploadedDocs[cfg.stateKey];
                    input.value = '';
                    const previewEl = document.getElementById(cfg.previewId);
                    const contentEl = document.getElementById(cfg.triggerId);
                    if (previewEl) previewEl.style.display = 'none';
                    if (contentEl) contentEl.style.display = 'flex';
                });
            }
        });
    }

    setupPaymentIconGrid() {
        const grid          = document.getElementById('paymentIconGrid');
        if (!grid) return;
        const primaryInput  = document.getElementById('primaryPayment');
        const backupInput   = document.getElementById('secondaryPayment');
        const otherInline   = document.getElementById('paymentOtherInline');
        let primaryCard     = null;
        let backupCard      = null;

        const updateBadge = (card, text, show) => {
            const badge = card.querySelector('.pic-badge');
            if (!badge) return;
            badge.textContent = text;
            badge.style.display = show ? 'block' : 'none';
        };

        const updateInputs = () => {
            if (primaryInput) primaryInput.value = primaryCard ? primaryCard.dataset.method : '';
            if (backupInput)  backupInput.value  = backupCard  ? backupCard.dataset.method  : '';
            const showOther = (primaryCard && primaryCard.dataset.method === 'Other') ||
                              (backupCard  && backupCard.dataset.method  === 'Other');
            if (otherInline) otherInline.classList.toggle('visible', !!showOther);
        };

        grid.querySelectorAll('.payment-icon-card').forEach(card => {
            card.addEventListener('click', () => {
                if (card === primaryCard) {
                    card.classList.remove('is-primary');
                    updateBadge(card, '', false);
                    primaryCard = backupCard;
                    backupCard  = null;
                    if (primaryCard) {
                        primaryCard.classList.remove('is-backup');
                        primaryCard.classList.add('is-primary');
                        updateBadge(primaryCard, 'Primary', true);
                    }
                } else if (card === backupCard) {
                    card.classList.remove('is-backup');
                    updateBadge(card, '', false);
                    backupCard = null;
                } else if (!primaryCard) {
                    primaryCard = card;
                    card.classList.add('is-primary');
                    updateBadge(card, 'Primary', true);
                } else {
                    if (backupCard) { backupCard.classList.remove('is-backup'); updateBadge(backupCard, '', false); }
                    backupCard = card;
                    card.classList.add('is-backup');
                    updateBadge(card, 'Backup', true);
                }
                updateInputs();
                const errEl = document.getElementById('primaryPaymentError');
                if (primaryCard && errEl) errEl.style.display = 'none';
            });
        });
    }

    setupCharacterCounters() {
        const textareas = document.querySelectorAll('textarea');
        textareas.forEach(textarea => {
            const parent = textarea.parentElement;
            const counter = document.createElement('div');
            counter.className = 'character-count';
            counter.style.fontSize = '11px';
            counter.style.textAlign = 'right';
            counter.style.color = '#7f8c8d';
            parent.appendChild(counter);
            const updateCounter = () => {
                const len = textarea.value.length;
                const max = textarea.getAttribute('maxlength') || 500;
                counter.textContent = `${len}/${max} ${this.t('characters')}`;
            };
            textarea.addEventListener('input', updateCounter);
            updateCounter();
        });
    }

    // P1-D: Attempt to restore saved progress.
    // If a draft < 7 days old exists, show a resume/discard banner instead of silently restoring.
    restoreSavedProgress() {
        const saved = localStorage.getItem(this.config.LOCAL_STORAGE_KEY);
        if (!saved) return;
        try {
            const data = JSON.parse(saved);
            if (!data._last_updated) {
                // Legacy draft without timestamp — restore silently
                this._doRestoreFromDraft(data);
                return;
            }
            const savedMs  = new Date(data._last_updated).getTime();
            const ageMs    = Date.now() - savedMs;
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            if (ageMs > sevenDaysMs) {
                // Draft is stale — discard silently
                localStorage.removeItem(this.config.LOCAL_STORAGE_KEY);
                return;
            }
            // Draft is fresh — show resume banner
            this._showDraftResumeBanner(data, savedMs);
        } catch (e) {}
    }

    // P1-D: Render the draft-resume banner above the form.
    _showDraftResumeBanner(data, savedMs) {
        const savedDate = new Date(savedMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const banner = document.createElement('div');
        banner.id = 'draftResumeBanner';
        banner.style.cssText = [
            'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:9999',
            'background:#0a1628', 'color:#fff', 'padding:14px 20px',
            'display:flex', 'align-items:center', 'justify-content:space-between',
            'gap:12px', 'flex-wrap:wrap', 'box-shadow:0 -4px 24px rgba(0,0,0,0.25)',
            'font-family:var(--font-body,sans-serif)', 'font-size:14px'
        ].join(';');
        banner.innerHTML = `
          <span style="display:flex;align-items:center;gap:8px">
            <i class="fas fa-history" style="color:#c9a84c"></i>
            <strong>Saved draft found</strong>&nbsp;—&nbsp;last edited ${savedDate}. Resume where you left off?
          </span>
          <span style="display:flex;gap:10px;flex-shrink:0">
            <button id="draftDiscardBtn" style="padding:8px 18px;border-radius:6px;border:1px solid rgba(255,255,255,0.3);background:transparent;color:#fff;cursor:pointer;font-size:13px;font-weight:600">
              Start Fresh
            </button>
            <button id="draftResumeBtn" style="padding:8px 18px;border-radius:6px;border:none;background:#c9a84c;color:#0a1628;cursor:pointer;font-size:13px;font-weight:700">
              Resume Draft
            </button>
          </span>`;
        document.body.appendChild(banner);

        document.getElementById('draftResumeBtn').addEventListener('click', () => {
            this._doRestoreFromDraft(data);
            banner.remove();
        });
        document.getElementById('draftDiscardBtn').addEventListener('click', () => {
            localStorage.removeItem(this.config.LOCAL_STORAGE_KEY);
            banner.remove();
        });
    }

    // P1-D: Actual restore logic, shared by silent restore and prompted restore.
    _doRestoreFromDraft(data) {
        Object.keys(data).forEach(key => {
            if (key === 'SSN' || key === 'Co-Applicant SSN') return;
            if (key.startsWith('_')) return; // skip internal metadata keys
            const el = document.getElementById(key);
            if (el) {
                if (el.type === 'checkbox') el.checked = data[key];
                else el.value = data[key];
            }
        });

        // Restore radio button groups — saved by FormData name, not by element id
        const radioGroups = [
            'Has Pets', 'Has Vehicle', 'Ever Evicted', 'Smoker',
            'Has Bankruptcy', 'Has Criminal History', 'Additional Person Role'
        ];
        radioGroups.forEach(name => {
            const savedValue = data[name];
            if (!savedValue) return;
            const radio = document.querySelector(
                `input[name="${CSS.escape(name)}"][value="${CSS.escape(savedValue)}"]`
            );
            if (radio) radio.checked = true;
        });

        // Re-trigger conditional field visibility to match restored radio state
        const petsYes     = document.getElementById('petsYes');
        const petGroup    = document.getElementById('petDetailsGroup');
        if (petsYes && petGroup) petGroup.style.display = petsYes.checked ? '' : 'none';

        const vehicleYes    = document.getElementById('vehicleYes');
        const vehicleSect   = document.getElementById('vehicleDetailsSection');
        if (vehicleYes && vehicleSect) vehicleSect.style.display = vehicleYes.checked ? 'block' : 'none';

        const evictedYes    = document.getElementById('evictedYes');
        const evictGroup    = document.getElementById('evictionExplainGroup');
        if (evictedYes && evictGroup) evictGroup.style.display = evictedYes.checked ? '' : 'none';

        const bankruptcyYes   = document.getElementById('bankruptcyYes');
        const bankruptcyGroup = document.getElementById('bankruptcyExplainGroup');
        if (bankruptcyYes && bankruptcyGroup) bankruptcyGroup.style.display = bankruptcyYes.checked ? '' : 'none';

        const criminalYes   = document.getElementById('criminalYes');
        const criminalGroup = document.getElementById('criminalExplainGroup');
        if (criminalYes && criminalGroup) criminalGroup.style.display = criminalYes.checked ? '' : 'none';

        // Restore co-applicant employment status (saved by name, not id)
        const coStatusSaved = data['Co-Applicant Employment Status'];
        const coStatusEl    = document.getElementById('coEmploymentStatus');
        if (coStatusEl && coStatusSaved) {
            coStatusEl.value = coStatusSaved;
            const EMPLOYED = ['Full-time', 'Part-time', 'Self-employed'];
            const coEmpGroup = document.getElementById('coEmployedFieldsGroup');
            if (coEmpGroup) coEmpGroup.style.display = EMPLOYED.includes(coStatusSaved) ? '' : 'none';
        }

        // Re-trigger prior residence conditional after draft values are loaded
        const residencyStartEl   = document.getElementById('residencyStart');
        const priorResidenceGrp  = document.getElementById('priorResidenceGroup');
        if (residencyStartEl && priorResidenceGrp) {
            priorResidenceGrp.style.display = this._isUnderTwoYears(residencyStartEl.value) ? '' : 'none';
        }

        if (data._language && data._language !== this.state.language) {
            this.state.language = data._language;
            this.applyTranslations();
        }

        // If the draft included a property selection (open-dropdown path) sync
        // _selectedPropertyId and re-enable the section 1 Next button so the user
        // does not get stuck with a permanently disabled Next after resuming.
        // In the locked-property path this is a no-op since loadLockedProperty()
        // will overwrite _selectedPropertyId via onPropertySelected() anyway.
        const restoredSelect = document.getElementById('propertySelect');
        if (restoredSelect && restoredSelect.value) {
            this._selectedPropertyId = restoredSelect.value;
            this._enableSection1Next();
        }
    }

    // P1-D: Save form data to localStorage and clear the unsaved-changes flag.
    saveProgress() {
        const data = this.getAllFormData();
        const sensitiveKeys = ['SSN', 'Application ID', 'Co-Applicant SSN'];
        sensitiveKeys.forEach(key => delete data[key]);
        data._last_updated = new Date().toISOString();
        data._language = this.state.language || 'en';
        localStorage.setItem(this.config.LOCAL_STORAGE_KEY, JSON.stringify(data));
        this._hasUnsavedChanges = false;
    }

    getAllFormData() {
        const form = document.getElementById('rentalApplication');
        const formData = new FormData(form);
        const data = {};
        formData.forEach((value, key) => { data[key] = value; });
        return data;
    }

    debounce(func, wait) {
        let timeout;
        return function() {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, arguments), wait);
        };
    }

    // ---------- Language toggle (unchanged, includes all keys) ----------
    // ═══════════════════════════════════════════════════════════════
    // TRANSLATION SYSTEM
    // Central translations object at class level.
    // Access anywhere via: this.t('key')
    // All error messages, labels, dynamic content live here.
    // ═══════════════════════════════════════════════════════════════

    buildTranslations() {
        this.translations = {
            en: {
                // ── Language toggle ──
                langText: 'Español',

                // ── Branding ──
                logoText: 'Choice Properties',
                tagline: 'Professional Property Management Solutions',
                confidentialStamp: 'CONFIDENTIAL & SECURE',
                trustIndicator: 'Your information is encrypted and protected',
                timeEstimate: 'Estimated time: 15-20 minutes',

                // ── Progress bar step labels ──
                step1Label: 'Property & Basics',
                step2Label: 'Residency',
                step3Label: 'Employment',
                step4Label: 'Documents',
                step5Label: 'References',
                step6Label: 'Payment',
                step7Label: 'Review',
                requiredFieldLegend: 'Required field',
                stepPrefix: 'Step',
                stepOf: 'of',

                // ── Submission progress ──
                processing: 'Processing',
                validating: 'Validating',
                submitting: 'Submitting',
                complete: 'Complete',
                submittingTitle: 'Submitting Your Application',
                submissionMessage: "Please don't close this window. This may take a few moments...",

                // ── Success / post-submit ──
                successTitle: 'Application Received',
                successText: 'Thank you for choosing Choice Properties',
                appId: 'Your Application ID',
                clickToCopy: 'Copy ID',
                immediateNextSteps: 'Immediate Next Steps',
                paymentRequiredTitle: 'Payment Required Before Review',
                paymentRequiredDesc: 'Our team will contact you shortly at the phone number provided to arrange the application fee.',
                completePaymentTitle: 'Complete Payment',
                completePaymentDesc: 'Your application is not complete until the fee has been paid. We\'ll discuss payment options you\'re familiar with.',
                reviewBeginsTitle: 'Review Begins',
                reviewBeginsDesc: 'Once payment is confirmed, your application enters the formal review process. You can track status online with your ID.',
                importantNote: 'Important:',
                paymentUrgentText: 'Your application is not complete until the application fee has been paid. Please keep your phone nearby.',
                yourPreferences: 'Your Preferences (For Follow-up After Payment)',
                contactMethod: 'Contact Method:',
                bestTimes: 'Best Times:',
                paymentPref: 'Payment Preferences:',
                preferenceNote: 'We\'ll use these for non-urgent follow-up after your payment is complete.',
                questions: 'Questions? Call or text',
                helpText: 'we\'re here to help.',
                trackStatus: 'Track My Application',
                newApplication: 'New Application',

                // ── Process explainer steps ──
                reapplicationPolicyTitle: 'Reapplication Protection',
                reapplicationPolicyText: 'If your application is denied, you may apply for any other available property within 30 days — no new application fee. Your screening results remain valid for 60 days.',
                step1YouSubmit: '1. You Submit',
                step1Desc: 'Fill out your application completely',
                step2PaymentArranged: '2. Payment Arranged',
                step2Desc: 'We contact you to arrange the fee',
                step3ReviewBegins: '3. Review Begins',
                step3Desc: 'After payment, we review your application',

                // ── Step 1: Property & Applicant ──
                propertyHeader: 'Property & Applicant Details',
                propertyInfo: 'Property Information',
                propertyAddressLabel: 'Property Address Applying For',
                propertyAddressPlaceholder: 'Street address, city, state, zip',
                errAddress: 'Please enter the property address',
                moveInLabel: 'Requested Move-in Date',
                errRequired: 'Required',
                leaseTermLabel: 'Desired Lease Term',
                selectTerm: 'Select term...',
                months6: '6 Months',
                months12: '12 Months',
                months18: '18 Months',
                months24: '24 Months',
                monthToMonth: 'Month-to-month',
                primaryApplicantInfo: 'Primary Applicant Information',
                firstNameLabel: 'First Name',
                lastNameLabel: 'Last Name',
                emailLabel: 'Email Address',
                emailPlaceholder: 'email@example.com',
                emailHint: 'Make sure the provided email is correct and accessible. Confirmation and updates sent here.',
                errEmail: 'Invalid email',
                phoneLabel: 'Phone Number',
                phonePlaceholder: '(555) 000-0000',
                phoneHint: 'Our team will contact you here.',
                errPhone: 'Invalid phone',
                dobLabel: 'Date of Birth',
                ssnLabel: 'Social Security Number (Last 4 Digits)',
                ssnHint: 'Only last 4 digits required',
                ssnPrivacyNote: '<i class="fas fa-shield-alt"></i> Encrypted in transit and stored in masked format (e.g., XXX-XX-1234). Used only for identity verification — never shared with third parties.',
                ssnPlaceholder: '1234',
                coApplicantSectionHeader: 'Co-Applicant / Guarantor',
                coApplicantCheckbox: 'I have a co-applicant or guarantor',
                coApplicantInfo: 'Additional Person Information',
                coRoleLabel: 'Role (Select one)',
                roleCoApplicant: 'Co-applicant (will live in the unit)',
                roleGuarantor: 'Guarantor (financial backup only)',
                coFirstNameLabel: 'First Name',
                coLastNameLabel: 'Last Name',
                coEmailLabel: 'Email',
                coPhoneLabel: 'Phone',
                coDobLabel: 'Date of Birth',
                coSsnLabel: 'SSN (Last 4)',
                employmentIncome: 'Employment & Income',
                coEmploymentStatusLabel: 'Employment Status',
                empFullTime: 'Full-time Employed',
                empPartTime: 'Part-time Employed',
                empSelfEmployed: 'Self-employed',
                empRetired: 'Retired',
                empStudent: 'Student',
                empUnemployed: 'Unemployed / Other',
                coEmployerLabel: 'Employer',
                coJobTitleLabel: 'Job Title',
                coMonthlyIncomeLabel: 'Gross Monthly Income ($)',
                coMonthlyIncomePlaceholder: 'e.g., 4000',
                coEmploymentDurationLabel: 'Length of Employment',
                coEmploymentDurationPlaceholder: 'e.g., 2 years',
                coConsentLabel: 'I authorise verification of the information provided for this additional person, including credit and background check.',
                contactPrefsHeader: 'Contact Preferences (For Follow-up After Payment)',
                prefContactMethod: 'Preferred Contact Method',
                contactMethodText: 'Text Message',
                contactMethodEmail: 'Email',
                contactMethodHint: 'You can select both methods',
                availabilityLabel: 'Availability for Follow-up (After Payment)',
                weekdays: 'Weekdays',
                timeMorning: 'Morning (8am-11am)',
                timeMidday: 'Midday (11am-2pm)',
                timeAfternoon: 'Afternoon (2pm-5pm)',
                eveningsWeekends: 'Evenings & Weekends',
                timeEarlyEvening: 'Early Evening (5pm-8pm)',
                timeLateEvening: 'Late Evening (8pm-10pm)',
                timeWeekend: 'Weekend',
                flexible: 'Flexible',
                timeAnytime: 'Anytime — I\'m flexible',
                additionalNotesLabel: 'Additional Notes (Optional)',
                additionalNotesPlaceholder: 'e.g., Best after 7pm, avoid Wednesdays',
                preferencesNote: 'These preferences are for non-urgent follow-up after your payment is complete.',

                // ── Navigation ──
                nextStep: 'Next Step',
                prevStep: 'Previous',
                editSection: 'Edit Section',

                // ── Step 2: Residency ──
                residencyHeader: 'Residency & Occupancy',
                currentResidence: 'Current Residence',
                currentAddressLabel: 'Current Address',
                currentAddressPlaceholder: 'Street, Unit #, City, State, Zip',
                residencyStartLabel: 'How long at this address?',
                residencyStartPlaceholder: 'e.g., 2 years 3 months',
                rentAmountLabel: 'Current Rent/Mortgage Amount',
                rentAmountPlaceholder: '$',
                reasonLeavingLabel: 'Reason for leaving',
                landlordNameLabel: 'Current Landlord/Property Manager Name',
                landlordPhoneLabel: 'Landlord/Property Manager Phone',
                landlordEmailLabel: 'Landlord Email (Optional)',
                governmentIdHeader: 'Government-Issued ID',
                govIdTypeLabel: 'ID Type',
                selectGovIdType: '— Select ID type —',
                idDriverLicense: "Driver's License",
                idStateID: 'State ID',
                idPassport: 'Passport',
                idMilitaryID: 'Military ID',
                idITIN: 'ITIN Card',
                govIdNumberLabel: 'ID Number',
                govIdNumberPlaceholder: 'As shown on your ID',
                govIdNumberHint: 'Stored securely and used only for identity verification.',
                priorResidenceHeader: 'Prior Residence',
                previousAddressLabel: 'Previous Address',
                previousAddressPlaceholder: 'Street, City, State, Zip',
                previousDurationLabel: 'How Long Did You Live There?',
                previousDurationPlaceholder: 'e.g., 2 years',
                previousLandlordNameLabel: 'Prior Landlord Name',
                previousLandlordPhoneLabel: 'Prior Landlord Phone',
                occupantsPets: 'Occupants & Pets',
                totalOccupantsLabel: 'Number of total occupants (including children)',
                occupantNamesLabel: 'Names and ages of all other occupants',
                occupantNamesPlaceholder: 'List names, ages, and relationship (e.g., Jane Doe, 7, daughter)',
                hasPetsLabel: 'Do you have any pets?',
                yes: 'Yes',
                no: 'No',
                petDetailsLabel: 'Pet details (type, breed, weight)',
                petDetailsPlaceholder: 'Describe your pets...',
                vehicleInfo: 'Vehicle Information',
                hasVehicleLabel: 'Do you have a vehicle?',
                vehicleMakeLabel: 'Make',
                vehicleModelLabel: 'Model',
                vehicleYearLabel: 'Year',
                vehicleYearPlaceholder: 'e.g., 2020',
                vehiclePlateLabel: 'License Plate (Optional)',

                // ── Step 3: Employment ──
                employmentHeader: 'Employment & Income',
                currentEmployment: 'Current Employment',
                employmentStatusLabel: 'Employment Status',
                selectStatus: 'Select status...',
                fullTime: 'Full-time',
                partTime: 'Part-time',
                selfEmployed: 'Self-employed',
                student: 'Student',
                retired: 'Retired',
                unemployed: 'Unemployed',
                employerLabel: 'Employer',
                jobTitleLabel: 'Job Title',
                employmentDurationLabel: 'How long at this job?',
                employmentDurationPlaceholder: 'e.g., 3 years',
                supervisorNameLabel: 'Supervisor Name',
                supervisorPhoneLabel: 'Supervisor Phone',
                incomeVerification: 'Income Information',
                monthlyIncomeLabel: 'Gross Monthly Income',
                monthlyIncomePlaceholder: '$',
                incomeHint: 'Before taxes and deductions',
                otherIncomeLabel: 'Additional Monthly Income (Optional)',
                otherIncomePlaceholder: '$',
                otherIncomeHint: 'Child support, disability, etc.',
                incomeRatioLabel: 'Income-to-Rent Ratio:',
                // Employment status — income label variants
                incomeLabel_Retired:    'Monthly Retirement / Pension Income',
                incomeLabel_Student:    'Monthly Income (all sources)',
                incomeLabel_Unemployed: 'Monthly Income (if any)',
                // Employment status — employer label variants
                employerLabel_Retired:    'Previous Employer or Pension Provider',
                employerLabel_Student:    'School / Institution',
                employerLabel_Unemployed: 'Most Recent Employer (Optional)',
                // Alt income source
                altIncomeSourceLabel: 'Income / Support Source',
                altIncomeSourcePlaceholder: 'e.g., Savings, Social Security, Financial Aid, Spouse income',

                // ── Step 4: References ──
                financialHeader: 'References, Emergency & Co-Applicant',
                personalReferences: 'Personal References',
                referencesHint: 'Please provide two references who are not relatives',
                ref1NameLabel: 'Reference 1 Name',
                ref1PhoneLabel: 'Reference 1 Phone',
                ref1EmailLabel: 'Reference 1 Email',
                ref1RelationshipLabel: 'Relationship',
                ref2NameLabel: 'Reference 2 Name',
                ref2PhoneLabel: 'Reference 2 Phone',
                ref2EmailLabel: 'Reference 2 Email',
                ref2RelationshipLabel: 'Relationship',
                emergencyInfo: 'Emergency Contact',
                emergencyNameLabel: 'Emergency Contact Name',
                emergencyPhoneLabel: 'Emergency Contact Phone',
                emergencyRelationshipLabel: 'Relationship to you',
                emergencyRelationshipPlaceholder: 'e.g., Spouse, Parent, Friend',
                additionalInfo: 'Additional Information',
                evictedLabel: 'Have you ever been evicted?',
                evictionExplainLabel: 'Please provide context',
                evictionExplainPlaceholder: 'e.g., No-fault eviction during COVID, dispute resolved, etc. Context helps our team make a fair assessment.',
                bankruptcyLabel: 'Have you filed for bankruptcy in the past 7 years?',
                bankruptcyExplainLabel: 'Please provide context',
                bankruptcyExplainPlaceholder: 'e.g., Chapter 7 discharged 2018, finances now stable',
                criminalLabel: 'Have you been convicted of a felony in the past 7 years?',
                criminalExplainLabel: 'Please provide context',
                criminalExplainPlaceholder: 'e.g., Non-violent offense, sentence completed, rehabilitation program',
                smokerLabel: 'Do you smoke?',

                // ── Step 5: Payment ──
                paymentHeader: 'Payment Preferences',
                paymentIntro: 'Tell us which payment services you use. When we contact you about the application fee, we\'ll discuss options you\'re familiar with.',
                paymentImportant: 'Payment must be completed before your application can be reviewed. Our team will contact you promptly after submission to arrange this.',
                primaryPref: 'Primary Preference',
                mainPaymentMethod: 'Your Main Payment Method',
                mainPaymentDesc: 'Which payment service do you use most often?',
                selectPrimary: '— Select your primary method —',
                other: 'Other',
                otherPaymentPlaceholder: 'Enter payment method',
                backupPref: 'Backup Options (Optional)',
                otherMethods: 'Other Methods You Use',
                otherMethodsDesc: 'If your primary isn\'t available, what else works for you?',
                secondaryMethod: 'Secondary Method',
                selectBackup: '— Select a backup (optional) —',
                thirdMethod: 'Third Method (Optional)',
                selectAnother: '— Select another (optional) —',
                duplicateWarning: 'Please select different payment methods for each choice.',

                // ── Step 6: Review & Submit ──
                reviewHeader: 'Review & Submit',
                feeTitle: 'Application Fee: —',
                feeDesc: 'This fee is required before review can begin. Our team will contact you immediately after submission to arrange payment.',
                paymentReminderTitle: 'Payment Required Before Review',
                paymentReminderDesc: 'Your application is not complete until the application fee has been paid. Our team will contact you shortly after submission to arrange this.',
                verificationTitle: 'Verify Your Contact Information',
                verificationDesc: 'Please confirm your email and phone number are correct. This is how our team will reach you regarding your application.',
                reapplicationPolicyTextShort: 'If denied, apply again within 30 days with no new fee. Screening results valid for 60 days.',
                legalDeclaration: 'Legal Declaration',
                legalCertify: 'I certify that the information provided in this application is true and correct to the best of my knowledge.',
                legalAuthorize: 'I authorize verification of the information provided, including employment, income, and references.',
                termsAgreeLabel: 'I agree to the <a href="/terms.html" target="_blank" style="color:var(--secondary,#2563eb);text-decoration:underline;">Terms and Conditions</a>',
                fcraTitle: 'Background &amp; Credit Check Authorization',
                fcraDisclosureText: 'In connection with your rental application, Choice Properties may obtain a consumer report (including a background check and/or credit report) from a consumer reporting agency. This report may include information about your character, general reputation, personal characteristics, and mode of living. You have the right to request disclosure of the nature and scope of any such investigation, and to receive a free copy of the report within 60 days of any adverse action decision.',
                fcraConsentLabel: 'I have read and understand the above disclosure, and I authorize Choice Properties to obtain a consumer report in connection with my rental application.',
                errFcraRequired: 'You must authorize the background &amp; credit check to proceed.',
                dataRetentionNote: '<i class="fas fa-info-circle"></i> Application data is retained in accordance with our <a href="/privacy.html" target="_blank" style="color:inherit;text-decoration:underline;">Privacy Policy</a>. You may request deletion at any time by contacting support.',
                landlordContactNote: '<i class="fas fa-info-circle"></i> We may contact your current landlord to verify your tenancy as part of the application review process.',
                submitBtn: 'Submit Application',
                submitDisclaimer: 'By clicking submit, your application will be securely transmitted to Choice Properties.',
                privacyPolicy: 'Privacy Policy',
                termsOfService: 'Terms of Service',
                contactSupport: 'Contact Support',

                // ── System messages ──
                progressSaved: 'Progress Saved',
                offlineMessage: 'You are currently offline. Progress will be saved locally.',
                notSpecified: 'Not specified',
                notSelected: 'Not selected',
                retry: 'Retry',
                offlineError: 'You are offline. Please check your internet connection and try again.',
                submissionFailed: 'Submission failed. Please try again.',
                characters: 'characters',

                // ── Validation error messages (moved from inline ternaries) ──
                errSSNRequired: 'Please enter the last 4 digits of your SSN.',
                errSSNLength: 'SSN must contain 4 digits.',
                errSSNNumbers: 'SSN must contain numbers only.',
                errDOBRequired: 'Please enter your date of birth.',
                errDOBInvalid: 'Please enter a valid date of birth (18+ required).',
                errDOBAge: 'Applicants must be at least 18 years old.',
                errMoveInRequired: 'Please select a move-in date.',
                errMoveInPast: 'Move-in date cannot be in the past.',
                errMoveInTooSoon: 'Please allow at least 3 days for processing. Select a later date.',
                errEmailSymbol: 'Email must include an @ symbol.',
                errEmailDomain: 'Add a valid domain (e.g., gmail.com).',
                errEmailFormat: 'Enter a valid email (example: name@email.com).',
                errPhoneInvalid: 'Invalid phone',
                errRoleRequired: 'Please select a role',
                errVerifyRequired: 'You must authorise verification',
                errLegalDeclarations: 'Please agree to all legal declarations before submitting.',

                // ── Duplicate detection dialog ──
                duplicateTitle: 'Existing Application Found',
                duplicateBody: 'It looks like you\'ve already submitted an application for this property.\n\nYour existing Application ID is: {id}\n\nClick OK to track your existing application, or Cancel to submit a new one anyway.',

                // ── Property banner ──
                pcbConfirmed: 'Confirmed',
                pcbAvailable: 'Available',
                pcbPerMonth: '/mo',
            },

            es: {
                // ── Language toggle ──
                langText: 'English',

                // ── Branding ──
                logoText: 'Choice Properties',
                tagline: 'Soluciones Profesionales de Administración de Propiedades',
                confidentialStamp: 'CONFIDENCIAL & SEGURO',
                trustIndicator: 'Su información está encriptada y protegida',
                timeEstimate: 'Tiempo estimado: 15-20 minutos',

                // ── Progress bar ──
                step1Label: 'Propiedad y Solicitante',
                step2Label: 'Residencia y Ocupación',
                step3Label: 'Empleo e Ingresos',
                step4Label: 'Referencias y Más',
                step5Label: 'Preferencias de Pago',
                step6Label: 'Revisar y Enviar',
                requiredFieldLegend: 'Campo obligatorio',
                stepPrefix: 'Paso',
                stepOf: 'de',

                // ── Submission progress ──
                processing: 'Procesando',
                validating: 'Validando',
                submitting: 'Enviando',
                complete: 'Completo',
                submittingTitle: 'Enviando su Solicitud',
                submissionMessage: 'Por favor no cierre esta ventana. Puede tomar unos momentos...',

                // ── Success / post-submit ──
                successTitle: 'Solicitud Recibida',
                successText: 'Gracias por elegir Choice Properties',
                appId: 'Su ID de Solicitud',
                clickToCopy: 'Copiar ID',
                immediateNextSteps: 'Próximos Pasos Inmediatos',
                paymentRequiredTitle: 'Pago Requerido Antes de la Revisión',
                paymentRequiredDesc: 'Nuestro equipo se comunicará con usted en breve al número proporcionado para coordinar el pago de la tarifa de solicitud.',
                completePaymentTitle: 'Completar el Pago',
                completePaymentDesc: 'Su solicitud no está completa hasta que se haya pagado la tarifa. Discutiremos opciones de pago que conozca.',
                reviewBeginsTitle: 'Comienza la Revisión',
                reviewBeginsDesc: 'Una vez que se confirme el pago, su solicitud entra en el proceso de revisión formal. Puede seguir el estado en línea con su ID.',
                importantNote: 'Importante:',
                paymentUrgentText: 'Su solicitud no está completa hasta que se haya pagado la tarifa de solicitud. Por favor mantenga su teléfono cerca.',
                yourPreferences: 'Sus Preferencias (Para Seguimiento Después del Pago)',
                contactMethod: 'Método de Contacto:',
                bestTimes: 'Mejores Horarios:',
                paymentPref: 'Preferencias de Pago:',
                preferenceNote: 'Usaremos estas para seguimiento no urgente después de que se complete su pago.',
                questions: '¿Preguntas? Llame o envíe un mensaje de texto al',
                helpText: 'estamos aquí para ayudar.',
                trackStatus: 'Seguir Mi Solicitud',
                newApplication: 'Nueva Solicitud',

                // ── Process explainer ──
                reapplicationPolicyTitle: 'Protección de Reaplicación',
                reapplicationPolicyText: 'Si su solicitud es denegada, puede solicitar cualquier otra propiedad disponible dentro de los 30 días sin pagar otra tarifa de solicitud. Sus resultados de evaluación siguen siendo válidos por 60 días.',
                step1YouSubmit: '1. Usted Envía',
                step1Desc: 'Complete su solicitud completamente',
                step2PaymentArranged: '2. Pago Acordado',
                step2Desc: 'Lo contactamos para coordinar la tarifa',
                step3ReviewBegins: '3. Comienza la Revisión',
                step3Desc: 'Después del pago, revisamos su solicitud',

                // ── Step 1 ──
                propertyHeader: 'Detalles de la Propiedad y el Solicitante',
                propertyInfo: 'Información de la Propiedad',
                propertyAddressLabel: 'Dirección de la Propiedad que Solicita',
                propertyAddressPlaceholder: 'Calle, ciudad, estado, código postal',
                errAddress: 'Por favor ingrese la dirección de la propiedad',
                moveInLabel: 'Fecha de Mudanza Solicitada',
                errRequired: 'Obligatorio',
                leaseTermLabel: 'Plazo de Arrendamiento Deseado',
                selectTerm: 'Seleccionar plazo...',
                months6: '6 Meses',
                months12: '12 Meses',
                months18: '18 Meses',
                months24: '24 Meses',
                monthToMonth: 'Mes a mes',
                primaryApplicantInfo: 'Información del Solicitante Principal',
                firstNameLabel: 'Nombre',
                lastNameLabel: 'Apellido',
                emailLabel: 'Correo Electrónico',
                emailPlaceholder: 'email@ejemplo.com',
                emailHint: 'Asegúrese de que el correo proporcionado sea correcto y accesible. La confirmación y actualizaciones se enviarán aquí.',
                errEmail: 'Correo inválido',
                phoneLabel: 'Número de Teléfono',
                phonePlaceholder: '(555) 000-0000',
                phoneHint: 'Nuestro equipo lo contactará aquí.',
                errPhone: 'Teléfono inválido',
                dobLabel: 'Fecha de Nacimiento',
                ssnLabel: 'Número de Seguro Social (Últimos 4 dígitos)',
                ssnHint: 'Solo últimos 4 dígitos requeridos',
                ssnPrivacyNote: '<i class="fas fa-shield-alt"></i> Encriptado en tránsito y almacenado en formato enmascarado (ej. XXX-XX-1234). Usado solo para verificación de identidad — nunca compartido con terceros.',
                ssnPlaceholder: '1234',
                coApplicantSectionHeader: 'Co-Solicitante / Fiador',
                coApplicantCheckbox: 'Tengo un co-solicitante o fiador',
                coApplicantInfo: 'Información de Persona Adicional',
                coRoleLabel: 'Rol (Seleccione uno)',
                roleCoApplicant: 'Co-solicitante (vivirá en la unidad)',
                roleGuarantor: 'Fiador (solo respaldo financiero)',
                coFirstNameLabel: 'Nombre',
                coLastNameLabel: 'Apellido',
                coEmailLabel: 'Correo Electrónico',
                coPhoneLabel: 'Teléfono',
                coDobLabel: 'Fecha de Nacimiento',
                coSsnLabel: 'SSN (Últimos 4)',
                employmentIncome: 'Empleo e Ingresos',
                coEmploymentStatusLabel: 'Estado Laboral',
                empFullTime: 'Empleado a tiempo completo',
                empPartTime: 'Empleado a tiempo parcial',
                empSelfEmployed: 'Trabajador independiente',
                empRetired: 'Jubilado',
                empStudent: 'Estudiante',
                empUnemployed: 'Desempleado / Otro',
                coEmployerLabel: 'Empleador',
                coJobTitleLabel: 'Puesto',
                coMonthlyIncomeLabel: 'Ingreso Mensual Bruto ($)',
                coMonthlyIncomePlaceholder: 'ej., 4000',
                coEmploymentDurationLabel: 'Tiempo en el empleo',
                coEmploymentDurationPlaceholder: 'ej., 2 años',
                coConsentLabel: 'Autorizo la verificación de la información proporcionada para esta persona adicional, incluyendo verificación de crédito y antecedentes.',
                contactPrefsHeader: 'Preferencias de Contacto (Para Seguimiento Después del Pago)',
                prefContactMethod: 'Método de Contacto Preferido',
                contactMethodText: 'Mensaje de Texto',
                contactMethodEmail: 'Correo Electrónico',
                contactMethodHint: 'Puede seleccionar ambos métodos',
                availabilityLabel: 'Disponibilidad para Seguimiento (Después del Pago)',
                weekdays: 'Días de semana',
                timeMorning: 'Mañana (8am-11am)',
                timeMidday: 'Mediodía (11am-2pm)',
                timeAfternoon: 'Tarde (2pm-5pm)',
                eveningsWeekends: 'Tardes y Fines de Semana',
                timeEarlyEvening: 'Temprano en la tarde (5pm-8pm)',
                timeLateEvening: 'Tarde noche (8pm-10pm)',
                timeWeekend: 'Fin de semana',
                flexible: 'Flexible',
                timeAnytime: 'En cualquier momento — soy flexible',
                additionalNotesLabel: 'Notas Adicionales (Opcional)',
                additionalNotesPlaceholder: 'ej., Mejor después de las 7pm, evitar miércoles',
                preferencesNote: 'Usaremos estas para seguimiento no urgente después de que se complete su pago.',

                // ── Navigation ──
                nextStep: 'Siguiente Paso',
                prevStep: 'Anterior',
                editSection: 'Editar Sección',

                // ── Step 2 ──
                residencyHeader: 'Residencia y Ocupación',
                currentResidence: 'Residencia Actual',
                currentAddressLabel: 'Dirección Actual',
                currentAddressPlaceholder: 'Calle, Número, Ciudad, Estado, Código Postal',
                residencyStartLabel: '¿Cuánto tiempo en esta dirección?',
                residencyStartPlaceholder: 'ej., 2 años 3 meses',
                rentAmountLabel: 'Monto Actual de Alquiler/Hipoteca',
                rentAmountPlaceholder: '$',
                reasonLeavingLabel: 'Razón para mudarse',
                landlordNameLabel: 'Nombre del Propietario/Administrador Actual',
                landlordPhoneLabel: 'Teléfono del Propietario/Administrador',
                landlordEmailLabel: 'Correo del Propietario (Opcional)',
                governmentIdHeader: 'Identificación Oficial',
                govIdTypeLabel: 'Tipo de ID',
                selectGovIdType: '— Seleccione tipo de ID —',
                idDriverLicense: 'Licencia de Conducir',
                idStateID: 'Identificación Estatal',
                idPassport: 'Pasaporte',
                idMilitaryID: 'ID Militar',
                idITIN: 'Tarjeta ITIN',
                govIdNumberLabel: 'Número de ID',
                govIdNumberPlaceholder: 'Tal como aparece en su ID',
                govIdNumberHint: 'Almacenado de forma segura y utilizado únicamente para verificación de identidad.',
                priorResidenceHeader: 'Residencia Anterior',
                previousAddressLabel: 'Dirección Anterior',
                previousAddressPlaceholder: 'Calle, Ciudad, Estado, Código Postal',
                previousDurationLabel: '¿Cuánto Tiempo Vivió Ahí?',
                previousDurationPlaceholder: 'ej., 2 años',
                previousLandlordNameLabel: 'Nombre del Propietario Anterior',
                previousLandlordPhoneLabel: 'Teléfono del Propietario Anterior',
                occupantsPets: 'Ocupantes y Mascotas',
                totalOccupantsLabel: 'Número total de ocupantes (incluyendo niños)',
                occupantNamesLabel: 'Nombres y edades de todos los demás ocupantes',
                occupantNamesPlaceholder: 'Lista de nombres, edades y relación (ej., Juan Pérez, 7, hijo)',
                hasPetsLabel: '¿Tiene mascotas?',
                yes: 'Sí',
                no: 'No',
                petDetailsLabel: 'Detalles de la mascota (tipo, raza, peso)',
                petDetailsPlaceholder: 'Describa sus mascotas...',
                vehicleInfo: 'Información del Vehículo',
                hasVehicleLabel: '¿Tiene vehículo?',
                vehicleMakeLabel: 'Marca',
                vehicleModelLabel: 'Modelo',
                vehicleYearLabel: 'Año',
                vehicleYearPlaceholder: 'ej., 2020',
                vehiclePlateLabel: 'Placa (Opcional)',

                // ── Step 3 ──
                employmentHeader: 'Empleo e Ingresos',
                currentEmployment: 'Empleo Actual',
                employmentStatusLabel: 'Estado de Empleo',
                selectStatus: 'Seleccionar estado...',
                fullTime: 'Tiempo completo',
                partTime: 'Medio tiempo',
                selfEmployed: 'Trabajador independiente',
                student: 'Estudiante',
                retired: 'Jubilado',
                unemployed: 'Desempleado',
                employerLabel: 'Empleador',
                jobTitleLabel: 'Puesto',
                employmentDurationLabel: '¿Cuánto tiempo en este trabajo?',
                employmentDurationPlaceholder: 'ej., 3 años',
                supervisorNameLabel: 'Nombre del supervisor',
                supervisorPhoneLabel: 'Teléfono del supervisor',
                incomeVerification: 'Información de Ingresos',
                monthlyIncomeLabel: 'Ingreso Mensual Bruto',
                monthlyIncomePlaceholder: '$',
                incomeHint: 'Antes de impuestos y deducciones',
                otherIncomeLabel: 'Otros Ingresos Mensuales (Opcional)',
                otherIncomePlaceholder: '$',
                otherIncomeHint: 'Pensión alimenticia, discapacidad, etc.',
                incomeRatioLabel: 'Relación Ingreso-Alquiler:',
                // Employment status — income label variants
                incomeLabel_Retired:    'Ingreso Mensual de Jubilación / Pensión',
                incomeLabel_Student:    'Ingreso Mensual (todas las fuentes)',
                incomeLabel_Unemployed: 'Ingreso Mensual (si tiene)',
                // Employment status — employer label variants
                employerLabel_Retired:    'Empleador Anterior o Proveedor de Pensión',
                employerLabel_Student:    'Escuela / Institución',
                employerLabel_Unemployed: 'Empleador Más Reciente (Opcional)',
                // Alt income source
                altIncomeSourceLabel: 'Fuente de Ingresos / Apoyo',
                altIncomeSourcePlaceholder: 'ej., Ahorros, Seguro Social, Ayuda Financiera, Ingreso del cónyuge',

                // ── Step 4 ──
                financialHeader: 'Referencias, Emergencia y Co-Solicitante',
                personalReferences: 'Referencias Personales',
                referencesHint: 'Por favor proporcione dos referencias que no sean parientes',
                ref1NameLabel: 'Nombre de Referencia 1',
                ref1PhoneLabel: 'Teléfono de Referencia 1',
                ref1EmailLabel: 'Correo de Referencia 1',
                ref1RelationshipLabel: 'Relación',
                ref2NameLabel: 'Nombre de Referencia 2',
                ref2PhoneLabel: 'Teléfono de Referencia 2',
                ref2EmailLabel: 'Correo de Referencia 2',
                ref2RelationshipLabel: 'Relación',
                emergencyInfo: 'Contacto de Emergencia',
                emergencyNameLabel: 'Nombre de Contacto de Emergencia',
                emergencyPhoneLabel: 'Teléfono de Contacto de Emergencia',
                emergencyRelationshipLabel: 'Relación con usted',
                emergencyRelationshipPlaceholder: 'ej., Cónyuge, Padre, Amigo',
                additionalInfo: 'Información Adicional',
                evictedLabel: '¿Ha sido desalojado alguna vez?',
                evictionExplainLabel: 'Por favor proporcione contexto',
                evictionExplainPlaceholder: 'ej., Desalojo sin culpa durante COVID, disputa resuelta, etc. El contexto ayuda a nuestro equipo a hacer una evaluación justa.',
                bankruptcyLabel: '¿Ha presentado quiebra en los últimos 7 años?',
                bankruptcyExplainLabel: 'Por favor proporcione contexto',
                bankruptcyExplainPlaceholder: 'ej., Capítulo 7 dado de baja en 2018, finanzas estables ahora',
                criminalLabel: '¿Ha sido condenado por un delito grave en los últimos 7 años?',
                criminalExplainLabel: 'Por favor proporcione contexto',
                criminalExplainPlaceholder: 'ej., Delito no violento, sentencia cumplida, programa de rehabilitación',
                smokerLabel: '¿Fuma?',

                // ── Step 5 ──
                paymentHeader: 'Preferencias de Pago',
                paymentIntro: 'Díganos qué servicios de pago utiliza. Cuando lo contactemos acerca de la tarifa de solicitud, discutiremos opciones con las que esté familiarizado.',
                paymentImportant: 'El pago debe completarse antes de que su solicitud pueda ser revisada. Nuestro equipo lo contactará rápidamente después del envío para organizar esto.',
                primaryPref: 'Preferencia Principal',
                mainPaymentMethod: 'Su Método de Pago Principal',
                mainPaymentDesc: '¿Qué servicio de pago usa con más frecuencia?',
                selectPrimary: '— Seleccione su método principal —',
                other: 'Otro',
                otherPaymentPlaceholder: 'Ingrese método de pago',
                backupPref: 'Opciones de Respaldo (Opcional)',
                otherMethods: 'Otros Métodos Que Usa',
                otherMethodsDesc: 'Si su principal no está disponible, ¿qué más le funciona?',
                secondaryMethod: 'Método Secundario',
                selectBackup: '— Seleccione un respaldo (opcional) —',
                thirdMethod: 'Tercer Método (Opcional)',
                selectAnother: '— Seleccione otro (opcional) —',
                duplicateWarning: 'Por favor seleccione diferentes métodos de pago para cada opción.',

                // ── Step 6 ──
                reviewHeader: 'Revisar y Enviar',
                feeTitle: 'Tarifa de Solicitud: —',
                feeDesc: 'Esta tarifa es requerida antes de que la revisión pueda comenzar. Nuestro equipo lo contactará inmediatamente después del envío para organizar el pago.',
                paymentReminderTitle: 'Pago Requerido Antes de la Revisión',
                paymentReminderDesc: 'Su solicitud no está completa hasta que se haya pagado la tarifa de solicitud. Nuestro equipo lo contactará poco después del envío para organizar esto.',
                verificationTitle: 'Verifique Su Información de Contacto',
                verificationDesc: 'Por favor confirme que su correo electrónico y número de teléfono sean correctos. Así es como nuestro equipo lo contactará acerca de su solicitud.',
                reapplicationPolicyTextShort: 'Si es denegado, puede aplicar nuevamente dentro de 30 días sin nueva tarifa. Resultados de evaluación válidos por 60 días.',
                legalDeclaration: 'Declaración Legal',
                legalCertify: 'Certifico que la información proporcionada en esta solicitud es verdadera y correcta a mi leal saber y entender.',
                legalAuthorize: 'Autorizo la verificación de la información proporcionada, incluyendo empleo, ingresos y referencias.',
                termsAgreeLabel: 'Acepto los <a href="/terms.html" target="_blank" style="color:var(--secondary,#2563eb);text-decoration:underline;">Términos y Condiciones</a>',
                fcraTitle: 'Autorización de Verificación de Antecedentes y Crédito',
                fcraDisclosureText: 'En relación con su solicitud de alquiler, Choice Properties puede obtener un informe del consumidor (incluyendo verificación de antecedentes y/o reporte de crédito) de una agencia de informes al consumidor. Este informe puede incluir información sobre su carácter, reputación general, características personales y modo de vida. Usted tiene el derecho de solicitar la divulgación de la naturaleza y alcance de cualquier investigación, y de recibir una copia gratuita del informe dentro de 60 días de cualquier decisión adversa.',
                fcraConsentLabel: 'He leído y entiendo la divulgación anterior, y autorizo a Choice Properties a obtener un informe del consumidor en relación con mi solicitud de alquiler.',
                errFcraRequired: 'Debe autorizar la verificación de antecedentes y crédito para continuar.',
                dataRetentionNote: '<i class="fas fa-info-circle"></i> Los datos de la solicitud se conservan según nuestra <a href="/privacy.html" target="_blank" style="color:inherit;text-decoration:underline;">Política de Privacidad</a>. Puede solicitar su eliminación en cualquier momento contactando a soporte.',
                landlordContactNote: '<i class="fas fa-info-circle"></i> Podemos contactar a su arrendador actual para verificar su arrendamiento como parte del proceso de revisión de la solicitud.',
                submitBtn: 'Enviar Solicitud',
                submitDisclaimer: 'Al hacer clic en enviar, su solicitud será transmitida de forma segura a Choice Properties.',
                privacyPolicy: 'Política de Privacidad',
                termsOfService: 'Términos de Servicio',
                contactSupport: 'Contactar Soporte',

                // ── System messages ──
                progressSaved: 'Progreso Guardado',
                offlineMessage: 'Actualmente está sin conexión. El progreso se guardará localmente.',
                notSpecified: 'No especificado',
                notSelected: 'No seleccionado',
                retry: 'Reintentar',
                offlineError: 'Estás sin conexión. Por favor verifica tu conexión a internet e intenta de nuevo.',
                submissionFailed: 'Error al enviar. Por favor intenta de nuevo.',
                characters: 'caracteres',

                // ── Validation error messages ──
                errSSNRequired: 'Por favor ingrese los últimos 4 dígitos de su SSN.',
                errSSNLength: 'El SSN debe contener 4 dígitos.',
                errSSNNumbers: 'El SSN debe contener solo números.',
                errDOBRequired: 'Por favor ingrese su fecha de nacimiento.',
                errDOBInvalid: 'Por favor ingrese una fecha válida (18+ requerido).',
                errDOBAge: 'Los solicitantes deben tener al menos 18 años.',
                errMoveInRequired: 'Por favor seleccione una fecha de mudanza.',
                errMoveInPast: 'La fecha de mudanza no puede ser en el pasado.',
                errMoveInTooSoon: 'Por favor permita al menos 3 días para el procesamiento.',
                errEmailSymbol: 'El correo debe incluir un símbolo @.',
                errEmailDomain: 'Agregue un dominio válido (ej. gmail.com).',
                errEmailFormat: 'Ingrese un correo válido (ejemplo: nombre@email.com).',
                errPhoneInvalid: 'Teléfono inválido',
                errRoleRequired: 'Por favor seleccione un rol',
                errVerifyRequired: 'Debe autorizar la verificación',
                errLegalDeclarations: 'Por favor acepte todas las declaraciones legales antes de enviar.',

                // ── Duplicate detection ──
                duplicateTitle: 'Solicitud Existente Encontrada',
                duplicateBody: 'Parece que ya ha enviado una solicitud para esta propiedad.\n\nSu ID de Solicitud existente es: {id}\n\nHaga clic en Aceptar para seguir su solicitud existente, o en Cancelar para enviar una nueva de todas formas.',

                // ── Property banner ──
                pcbConfirmed: 'Confirmado',
                pcbAvailable: 'Disponible',
                pcbPerMonth: '/mes',
            }
        };
    }

    // ── Translation helper — use anywhere as: this.t('key') ──
    t(key) {
        const lang = this.state.language || 'en';
        return (this.translations[lang] && this.translations[lang][key]) ||
               (this.translations['en'] && this.translations['en'][key]) ||
               key;
    }

    // ── Apply translations to all data-i18n elements in the DOM ──
    applyTranslations() {
        const t = this.translations[this.state.language] || this.translations.en;
        const langBtn = document.getElementById('langText');
        if (langBtn) langBtn.textContent = t.langText;

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (!t[key]) return;
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (el.placeholder !== undefined) el.placeholder = t[key];
            } else if (el.tagName === 'OPTION') {
                el.textContent = t[key];
            } else {
                // data-i18n-html allows translation values that contain safe HTML (e.g., anchor tags)
                if (el.hasAttribute('data-i18n-html')) {
                    el.innerHTML = t[key];
                } else {
                    el.textContent = t[key];
                }
            }
        });

        // Rebuild Next/Prev buttons (they contain both text and icons)
        document.querySelectorAll('.btn-next').forEach(b => {
            const icon = b.querySelector('i');
            b.innerHTML = '';
            const span = document.createElement('span');
            span.setAttribute('data-i18n', 'nextStep');
            span.textContent = t.nextStep;
            b.appendChild(span);
            if (icon) b.appendChild(icon);
        });
        document.querySelectorAll('.btn-prev').forEach(b => {
            const icon = b.querySelector('i');
            b.innerHTML = '';
            if (icon) b.appendChild(icon);
            const span = document.createElement('span');
            span.setAttribute('data-i18n', 'prevStep');
            span.textContent = t.prevStep;
            b.appendChild(span);
        });

        // Re-apply employment conditional labels in current language
        const statusEl = document.getElementById('employmentStatus');
        if (statusEl && statusEl.value) {
            this._applyEmploymentLabels(statusEl.value);
        }

        // Re-apply character counter suffix in current language
        document.querySelectorAll('.character-count').forEach(counter => {
            const text = counter.textContent;
            const match = text.match(/^(\d+\/\d+)/);
            if (match) counter.textContent = `${match[1]} ${t.characters}`;
        });

        this.updateProgressBar();
        if (this.getCurrentSection() === 6) this.generateApplicationSummary();
    }

    // ── Browser language auto-detection + toggle wiring ──
    setupLanguageToggle() {
        this.buildTranslations();

        // Auto-detect browser language — default to Spanish if device is set to Spanish
        const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
        if (browserLang.startsWith('es')) {
            this.state.language = 'es';
        } else {
            this.state.language = 'en';
        }

        // Apply initial translations immediately
        this.applyTranslations();

        // Wire the toggle button
        const btn = document.getElementById('langToggle');
        if (btn) {
            btn.addEventListener('click', () => {
                this.state.language = this.state.language === 'en' ? 'es' : 'en';
                this.applyTranslations();
                this.saveProgress();
            });
        }
    }

    // ---------- NEW: Distinguish error types ----------
    isTransientError(error) {
        const msg = error.message || error.toString();
        return msg.includes('network') || 
               msg.includes('timeout') || 
               msg.includes('Failed to fetch') ||
               msg.includes('ECONNREFUSED') ||
               msg.includes('Internet') ||
               msg.includes('offline');
    }

    // ---------- MODIFIED: showSubmissionError with auto-retry ----------
    showSubmissionError(error, isTransient = false) {
        const msgEl = document.getElementById('submissionMessage');
        const progressDiv = document.getElementById('submissionProgress');
        const statusArea = document.getElementById('statusArea');
        const spinner = document.getElementById('submissionSpinner');
        if (!msgEl || !progressDiv || !statusArea) return;

        const t = this.getTranslations();
        let errorMessage = error.message || error.toString();

        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }

        // Auto-retry logic
        if (isTransient && this.retryCount < this.maxRetries) {
            const delay = Math.pow(2, this.retryCount) * 1000; // 2,4,8 seconds
            this.retryCount++;
            
            msgEl.innerHTML = `${errorMessage} – ${t.retry} in ${delay/1000}s (attempt ${this.retryCount}/${this.maxRetries})`;
            statusArea.classList.add('error');
            if (spinner) {
                spinner.className = 'fas fa-spinner fa-pulse';
                spinner.style.color = '#e74c3c';
            }

            this.retryTimeout = setTimeout(() => {
                this.retryTimeout = null;
                statusArea.classList.remove('error');
                if (spinner) {
                    spinner.className = 'fas fa-spinner fa-pulse';
                    spinner.style.color = '';
                }
                this.updateSubmissionProgress(1, t.processing);
                this.handleFormSubmit(new Event('submit'));
            }, delay);
            return;
        }

        // Permanent error or max retries reached
        msgEl.innerHTML = errorMessage;
        statusArea.classList.add('error');
        if (spinner) {
            spinner.className = 'fas fa-exclamation-circle';
            spinner.style.color = '#e74c3c';
        }

        const currentStep = this.getCurrentSubmissionStep();
        if (currentStep) {
            const stepItem = document.getElementById(`stepItem${currentStep}`);
            if (stepItem) stepItem.classList.add('error');
        }

        let retryBtn = document.getElementById('submissionRetryBtn');
        if (!retryBtn) {
            retryBtn = document.createElement('button');
            retryBtn.id = 'submissionRetryBtn';
            retryBtn.className = 'btn btn-retry';
            retryBtn.innerHTML = `<i class="fas fa-redo-alt"></i> ${t.retry}`;
            retryBtn.style.marginTop = '15px';
            retryBtn.style.padding = '10px 20px';
            retryBtn.style.background = 'var(--secondary)';
            retryBtn.style.color = 'white';
            retryBtn.style.border = 'none';
            retryBtn.style.borderRadius = 'var(--border-radius)';
            retryBtn.style.cursor = 'pointer';
            progressDiv.appendChild(retryBtn);
        }
        retryBtn.style.display = 'inline-block';

        const newBtn = retryBtn.cloneNode(true);
        retryBtn.parentNode.replaceChild(newBtn, retryBtn);
        newBtn.addEventListener('click', () => {
            newBtn.style.display = 'none';
            statusArea.classList.remove('error');
            if (spinner) {
                spinner.className = 'fas fa-spinner fa-pulse';
                spinner.style.color = '';
            }
            if (currentStep) {
                const stepItem = document.getElementById(`stepItem${currentStep}`);
                if (stepItem) stepItem.classList.remove('error');
            }
            this.retryCount = 0;
            this.updateSubmissionProgress(1, t.processing);
            this.handleFormSubmit(new Event('submit'));
        });
    }

    getCurrentSubmissionStep() {
        for (let i = 1; i <= 4; i++) {
            const seg = document.getElementById(`progressSegment${i}`);
            if (seg && seg.classList.contains('active')) return i;
        }
        return null;
    }

    // ---------- MODIFIED: updateSubmissionProgress (unchanged from previous) ----------
    updateSubmissionProgress(step, customMessage) {
        const t = this.getTranslations();
        const messages = {
            1: t.processing,
            2: t.validating,
            3: t.submitting,
            4: t.complete
        };
        const msg = messages[step] || customMessage || '';
        const msgEl = document.getElementById('submissionMessage');
        if (msgEl) msgEl.textContent = msg;

        for (let i = 1; i <= 4; i++) {
            const seg = document.getElementById(`progressSegment${i}`);
            const stepItem = document.getElementById(`stepItem${i}`);
            if (seg) {
                seg.classList.remove('completed', 'active');
                if (i < step) seg.classList.add('completed');
                else if (i === step) seg.classList.add('active');
            }
            if (stepItem) {
                stepItem.classList.remove('completed', 'active', 'error');
                if (i < step) stepItem.classList.add('completed');
                else if (i === step) stepItem.classList.add('active');
            }
        }

        const spinner = document.getElementById('submissionSpinner');
        if (step === 4 && spinner) {
            spinner.className = 'fas fa-check-circle';
            spinner.style.color = '#27ae60';
        } else if (spinner) {
            spinner.className = 'fas fa-spinner fa-pulse';
            spinner.style.color = '';
        }
    }

    // ---------- MODIFIED: handleFormSubmit with retry reset ----------
    async handleFormSubmit(e) {
        e.preventDefault();

        this.retryCount = 0;
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }

        if (!navigator.onLine) {
            const t = this.getTranslations();
            this.showSubmissionError(new Error(t.offlineError), false);
            const submitBtn = document.getElementById('mainSubmitBtn');
            if (submitBtn) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
            }
            this.setState({ isSubmitting: false });
            return;
        }

        // FCRA consent is its own block with its own error element
        const fcraConsent = document.getElementById('fcraConsent');
        if (fcraConsent && !fcraConsent.checked) {
            const fcraErr = document.getElementById('fcraConsentError');
            if (fcraErr) fcraErr.style.display = 'block';
            fcraConsent.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const submitBtn = document.getElementById('mainSubmitBtn');
            if (submitBtn) { submitBtn.classList.remove('loading'); submitBtn.disabled = false; }
            this.setState({ isSubmitting: false });
            return;
        }
        if (fcraConsent) {
            const fcraErr = document.getElementById('fcraConsentError');
            if (fcraErr) fcraErr.style.display = 'none';
        }

        const certify = document.getElementById('certifyCorrect');
        const authorize = document.getElementById('authorizeVerify');
        const terms = document.getElementById('termsAgree');
        if (!certify.checked || !authorize.checked || !terms.checked) {
            // Show inline error under the legal checkboxes instead of alert()
            let legalErr = document.getElementById('legalDeclarationError');
            if (!legalErr) {
                legalErr = document.createElement('div');
                legalErr.id = 'legalDeclarationError';
                legalErr.className = 'error-message';
                legalErr.style.cssText = 'display:block;margin-top:10px;font-size:13px;';
                const legalSection = document.querySelector('.legal-checkbox-group');
                if (legalSection) legalSection.after(legalErr);
            }
            legalErr.textContent = this.t('errLegalDeclarations');
            legalErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const submitBtn = document.getElementById('mainSubmitBtn');
            if (submitBtn) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
            }
            this.setState({ isSubmitting: false });
            return;
        }
        // Clear legal error if all checked
        const legalErr = document.getElementById('legalDeclarationError');
        if (legalErr) legalErr.textContent = '';

        for (let i = 1; i <= 5; i++) {
            if (!this.validateStep(i)) {
                this.showSection(i);
                this.updateProgressBar();
                return;
            }
        }

        // Validate SSN fields (moved to step 6)
        const ssnField = document.getElementById('ssn');
        if (ssnField && !this.validateField(ssnField)) {
            ssnField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        const hasCoApp = document.getElementById('hasCoApplicant');
        if (hasCoApp && hasCoApp.checked) {
            const coSsnField = document.getElementById('coSsn');
            if (coSsnField) {
                const coSsnVal = coSsnField.value.replace(/\D/g, '');
                if (!coSsnVal || coSsnVal.length < 4) {
                    this.showError(coSsnField, this.t('errSSNRequired'));
                    coSsnField.classList.add('is-invalid', 'shake');
                    setTimeout(() => coSsnField.classList.remove('shake'), 400);
                    coSsnField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return;
                }
            }
        }

        const submitBtn = document.getElementById('mainSubmitBtn');
        if (submitBtn) {
            submitBtn.classList.add('loading');
            submitBtn.disabled = true;
        }

        this.setState({ isSubmitting: true });
        this.showSubmissionProgress();

        try {
            const t = this.getTranslations();
            this.updateSubmissionProgress(1, t.processing);

            const form = document.getElementById('rentalApplication');
            // Build JSON payload — collect multi-value checkboxes as arrays
            const rawFormData = new FormData(form);
            const jsonPayload = {};
            // Fields that can have multiple checked values
            const multiFields = ['Preferred Contact Method'];
            rawFormData.forEach((value, key) => {
                if (multiFields.includes(key)) {
                    if (!jsonPayload[key]) jsonPayload[key] = [];
                    if (!Array.isArray(jsonPayload[key])) jsonPayload[key] = [jsonPayload[key]];
                    jsonPayload[key].push(value);
                } else {
                    jsonPayload[key] = value;
                }
            });
            // Also collect any unchecked multi-fields as empty arrays (so edge fn gets them)
            multiFields.forEach(f => { if (!jsonPayload[f]) jsonPayload[f] = []; });

            // Strip currency formatting from income fields before submit
            ['Monthly Income', 'Other Income', 'Co-Applicant Monthly Income', 'Current Rent Amount'].forEach(k => {
                if (jsonPayload[k]) jsonPayload[k] = jsonPayload[k].replace(/[^0-9.]/g, '');
            });

            // Pre-fill propertyId / landlordId from selected dropdown (Option B — always from listing).
            // this._selectedPropertyId is the single source of truth; DOM and URL are fallbacks.
            const urlParams = new URLSearchParams(window.location.search);
            const selectedPropId = this._selectedPropertyId
                || document.getElementById('propertySelect')?.value
                || urlParams.get('propertyId');
            if (selectedPropId) {
                jsonPayload['listing_property_id'] = selectedPropId;
                // Fetch fee from selected property record
                const propData = this._properties && this._properties[selectedPropId];
                jsonPayload['application_fee'] = propData ? (parseInt(propData.application_fee) || 0) : 0;
                // Also pull landlord_id from property if available
                if (propData && propData.landlord_id) jsonPayload['landlord_id'] = propData.landlord_id;
            }
            if (urlParams.get('landlordId') && !jsonPayload['landlord_id']) jsonPayload['landlord_id'] = urlParams.get('landlordId');

            // Pass preferred language — enables bilingual emails and admin context
            jsonPayload['preferred_language'] = this.state.language || 'en';

            // ── Duplicate detection is handled server-side ───────────
            // process-application returns { duplicate: true, existing_app_id } with HTTP 409
            // if an active application exists for the same email+property.
            this.updateSubmissionProgress(2, t.validating);

            const response = await fetch(this.BACKEND_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify(jsonPayload)
            });

            const result = await response.json();
            // Edge function returns snake_case app_id — normalise to appId
            if (result.app_id) result.appId = result.app_id;

            // ── Property no longer active (HTTP 410) ────────────────
            if (response.status === 410 && result.property_inactive) {
                throw new Error(
                    'This property is no longer accepting applications — it may have been filled or removed. ' +
                    'Please return to our listings to find an available property.'
                );
            }

            // ── Server-side duplicate detected (HTTP 409) ────────────
            if (response.status === 409 && result.duplicate && result.existing_app_id) {
                this.hideSubmissionProgress();
                const userChoice = await this.showDuplicateBanner(result.existing_app_id);
                if (userChoice === 'dashboard') {
                    window.location.href = `/apply/dashboard.html?id=${result.existing_app_id}`;
                    return;
                }
                // User chose to re-submit anyway — re-show progress and fall through
                // We need to resubmit; reset submit button and call again
                const submitBtn = document.getElementById('mainSubmitBtn');
                if (submitBtn) { submitBtn.classList.remove('loading'); submitBtn.disabled = false; }
                this.setState({ isSubmitting: false });
                return;
            }

            if (result.success) {
                this.updateSubmissionProgress(3, t.submitting);
                await this.delay(500);
                this.updateSubmissionProgress(4, t.complete);
                await this.delay(500);
                this.handleSubmissionSuccess(result.appId);
            } else {
                throw new Error(result.error || 'Submission failed');
            }

        } catch (error) {
            console.error('Submission error:', error);
            const submitBtn = document.getElementById('mainSubmitBtn');
            if (submitBtn) {
                submitBtn.classList.remove('loading');
                submitBtn.disabled = false;
            }
            this.setState({ isSubmitting: false });
            
            const isTransient = this.isTransientError(error);
            this.showSubmissionError(error, isTransient);
        }
    }

    // ---------- MODIFIED: show/hide progress with backdrop ----------
    showSubmissionProgress() {
        const progress = document.getElementById('submissionProgress');
        const backdrop = document.getElementById('modalBackdrop');
        const form = document.getElementById('rentalApplication');
        if (progress) progress.style.display = 'block';
        if (backdrop) backdrop.style.display = 'block';
        if (form) form.style.display = 'none';
    }

    hideSubmissionProgress() {
        const progress = document.getElementById('submissionProgress');
        const backdrop = document.getElementById('modalBackdrop');
        const form = document.getElementById('rentalApplication');
        if (progress) progress.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
        if (form) form.style.display = 'block';
    }

    // ---------- Inline duplicate banner (replaces confirm() dialog) ----------
    showDuplicateBanner(existingId) {
        return new Promise((resolve) => {
            // Remove any existing banner
            const old = document.getElementById('duplicateBanner');
            if (old) old.remove();

            const banner = document.createElement('div');
            banner.id = 'duplicateBanner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#fffbeb;border-bottom:3px solid #f59e0b;padding:20px 24px;box-shadow:0 4px 24px rgba(0,0,0,0.12);display:flex;align-items:center;gap:16px;flex-wrap:wrap;';
            banner.innerHTML = `
                <div style="flex:1;min-width:220px;">
                    <div style="font-weight:700;font-size:15px;color:#92400e;margin-bottom:4px;">⚠️ Existing Application Found</div>
                    <div style="font-size:13px;color:#78350f;line-height:1.5;">You already have an active application for this property. Your Application ID is <strong style="font-family:monospace;">${existingId}</strong>.</div>
                </div>
                <div style="display:flex;gap:10px;flex-shrink:0;">
                    <button id="dupGoDash" style="background:#f59e0b;color:#fff;border:none;border-radius:6px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;">Track Existing Application</button>
                    <button id="dupResubmit" style="background:#fff;color:#92400e;border:1.5px solid #f59e0b;border-radius:6px;padding:10px 18px;font-weight:700;font-size:13px;cursor:pointer;">Submit New Anyway</button>
                </div>`;

            document.body.prepend(banner);
            window.scrollTo({ top: 0, behavior: 'smooth' });

            document.getElementById('dupGoDash').addEventListener('click', () => {
                banner.remove();
                resolve('dashboard');
            });
            document.getElementById('dupResubmit').addEventListener('click', () => {
                banner.remove();
                resolve('resubmit');
            });
        });
    }


    handleSubmissionSuccess(appId) {
        this.hideSubmissionProgress();
        this.clearSavedProgress();
        sessionStorage.setItem('lastSuccessAppId', appId);

        // Property context lives in sessionStorage (set by loadLockedProperty).
        // Pass only the appId in the URL — the success page reads everything else
        // from sessionStorage so the URL stays clean and readable.
        window.location.href = `/apply/success.html?appId=${encodeURIComponent(appId)}`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getTranslations() {
        return this.translations[this.state.language] || this.translations['en'];
    }

    clearSavedProgress() {
        localStorage.removeItem(this.config.LOCAL_STORAGE_KEY);
    }

    generateApplicationSummary() {
        const summaryContainer = document.getElementById('applicationSummary');
        if (!summaryContainer) return;

        const form = document.getElementById('rentalApplication');
        const formData = new FormData(form);
        const data = {};
        formData.forEach((value, key) => {
            if (value && key !== 'Application ID') {
                data[key] = value;
            }
        });

        const t = this.getTranslations();

        const groups = [
            { id: 1, name: 'Property & Applicant', fields: [
                'Property Address', 'Requested Move-in Date', 'Desired Lease Term',
                'First Name', 'Last Name', 'Email', 'Phone', 'DOB', 'SSN'
            ]},
            { id: 1, name: 'Co-Applicant', fields: [
                'Has Co-Applicant', 'Additional Person Role',
                'Co-Applicant First Name', 'Co-Applicant Last Name',
                'Co-Applicant Email', 'Co-Applicant Phone',
                'Co-Applicant DOB', 'Co-Applicant SSN',
                'Co-Applicant Employer', 'Co-Applicant Job Title',
                'Co-Applicant Monthly Income', 'Co-Applicant Employment Duration',
                'Co-Applicant Consent'
            ]},
            { id: 2, name: 'Residency', fields: [
                'Current Address', 'Residency Duration', 'Current Rent Amount',
                'Reason for leaving', 'Current Landlord Name', 'Landlord Phone', 'Landlord Email',
                'Government ID Type', 'Government ID Number',
                'Previous Address', 'Previous Residency Duration', 'Previous Landlord Name', 'Previous Landlord Phone'
            ]},
            { id: 2, name: 'Occupancy & Vehicles', fields: [
                'Total Occupants', 'Additional Occupants', 'Has Pets', 'Pet Details',
                'Has Vehicle', 'Vehicle Make', 'Vehicle Model', 'Vehicle Year', 'Vehicle License Plate'
            ]},
            { id: 3, name: 'Employment & Income', fields: [
                'Employment Status', 'Employer', 'Job Title', 'Employment Duration',
                'Supervisor Name', 'Supervisor Phone', 'Employment Start Date', 'Employer Address',
                'Monthly Income', 'Other Income'
            ]},
            { id: 4, name: 'Financial & References', fields: [
                'Emergency Contact Name', 'Emergency Contact Phone', 'Emergency Contact Relationship',
                'Reference 1 Name', 'Reference 1 Phone', 'Reference 1 Email', 'Reference 1 Relationship',
                'Reference 2 Name', 'Reference 2 Phone', 'Reference 2 Email', 'Reference 2 Relationship',
                'Has Bankruptcy', 'Bankruptcy Explanation', 'Has Criminal History', 'Criminal History Explanation'
            ]},
            { id: 5, name: 'Payment Preferences', fields: [
                'Primary Payment Method', 'Primary Payment Method Other',
                'Alternative Payment Method', 'Alternative Payment Method Other',
                'Third Choice Payment Method', 'Third Choice Payment Method Other'
            ]}
        ];

        const displayLabels = {
            'SSN': 'SSN (Last 4 Digits)',
            'Co-Applicant SSN': 'Co-Applicant SSN (Last 4)',
            'Has Co-Applicant': 'Has Co-Applicant/Guarantor',
            'Additional Person Role': 'Role'
        };

        // Fields to mask in the review summary
        const maskedFields = new Set(['SSN', 'Co-Applicant SSN']);

        let summaryHtml = '';
        groups.forEach(group => {
            let groupFieldsHtml = '';
            group.fields.forEach(field => {
                const value = data[field];
                const displayLabel = displayLabels[field] || field;
                if (value && value !== '') {
                    const displayValue = maskedFields.has(field) ? '••••' : value;
                    groupFieldsHtml += `
                        <div class="summary-item">
                            <div class="summary-label">${displayLabel}</div>
                            <div class="summary-value">${displayValue}</div>
                        </div>`;
                }
            });

            if (groupFieldsHtml) {
                summaryHtml += `
                    <div class="summary-group" onclick="window.app.goToSection(${group.id})" style="cursor: pointer; transition: background 0.2s;">
                        <div class="summary-header">
                            <span>${group.name}</span>
                            <span style="font-size: 12px; color: var(--secondary); display: flex; align-items: center; gap: 4px;">
                                <i class="fas fa-edit"></i> ${t.editSection}
                            </span>
                        </div>
                        <div class="summary-content">
                            ${groupFieldsHtml}
                        </div>
                    </div>`;
            }
        });

        summaryContainer.innerHTML = summaryHtml;
    }

    goToSection(sectionNumber) {
        this.hideSection(this.getCurrentSection());
        this.showSection(sectionNumber);
        this.updateProgressBar();
    }

}

// ---------- Global copy function ----------
window.copyAppId = function() {
    const appId = document.getElementById('successAppId')?.innerText;
    if (!appId) return;
    const _doToast = () => {
        const btn = document.querySelector('.copy-btn');
        if (!btn) return;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.style.background = '#d1fae5';
        btn.style.color = '#065f46';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.style.color = ''; }, 2000);
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(appId).then(_doToast).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = appId; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); _doToast(); } catch(e) {}
            document.body.removeChild(ta);
        });
    } else {
        const ta = document.createElement('textarea');
        ta.value = appId; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); _doToast(); } catch(e) {}
        document.body.removeChild(ta);
    }
};

// ============================================================
// TEST DATA FILL FUNCTIONALITY (unchanged)
// ============================================================
(function() {
    const initTestButton = () => {
        const testBtn = document.getElementById('testFillBtn');
        if (!testBtn) return;

        // Only show test button on localhost / 127.0.0.1
        const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
        const container = document.getElementById('testButtonContainer');
        if (!isLocal) {
            if (container) container.style.display = 'none';
            return;
        }
        
        testBtn.addEventListener('click', function(e) {
            e.preventDefault();
            fillTestData();
        });
    };
    
    function fillTestData() {
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 30);
        const futureDateStr = futureDate.toISOString().split('T')[0];
        
        const pastDateStr = '1990-01-15';
        
        // Step 1
        safeSetValue('propertyAddress', '123 Main Street, Troy, MI 48083');
        safeSetValue('requestedMoveIn', futureDateStr);
        safeSetValue('firstName', 'John');
        safeSetValue('lastName', 'Testerson');
        safeSetValue('email', 'test@example.com');
        safeSetValue('phone', '(555) 123-4567');
        safeSetValue('dob', pastDateStr);
        safeSetValue('ssn', '1234');
        safeSetValue('contactTimeSpecific', 'Best after 6pm, avoid Wednesdays');
        
        safeSetSelect('desiredLeaseTerm', '12 months');
        
        safeSetCheckbox('contactMethodText', true);
        safeSetCheckbox('contactMethodEmail', true);
        
        // Co-applicant
        safeSetCheckbox('hasCoApplicant', true);
        safeSetCheckbox('roleCoApplicant', true);
        safeSetValue('coFirstName', 'Jane');
        safeSetValue('coLastName', 'Testerson');
        safeSetValue('coEmail', 'jane@example.com');
        safeSetValue('coPhone', '(555) 987-6543');
        safeSetValue('coDob', '1992-03-20');
        safeSetValue('coSsn', '5678');
        safeSetValue('coEmployer', 'ABC Corp');
        safeSetValue('coJobTitle', 'Analyst');
        safeSetValue('coMonthlyIncome', '4500');
        safeSetValue('coEmploymentDuration', '3 years');
        safeSetCheckbox('coConsent', true);
        
        // Step 2
        safeSetValue('currentAddress', '456 Oak Avenue, Troy, MI 48083');
        safeSetValue('residencyStart', '3 years 2 months');
        safeSetValue('rentAmount', '1500');
        safeSetValue('reasonLeaving', 'Relocating for work opportunity');
        safeSetValue('landlordName', 'Sarah Johnson');
        safeSetValue('landlordPhone', '(555) 987-6543');
        safeSetValue('totalOccupants', '2');
        safeSetValue('occupantNames', 'Emma (age 7, daughter)');
        
        document.getElementById('petsYes')?.click();
        safeSetValue('petDetails', 'One friendly golden retriever, 65 lbs');
        
        // Vehicle
        document.getElementById('vehicleYes')?.click();
        safeSetValue('vehicleMake', 'Toyota');
        safeSetValue('vehicleModel', 'Camry');
        safeSetValue('vehicleYear', '2020');
        safeSetValue('vehiclePlate', 'ABC123');
        
        // Step 3
        safeSetSelect('employmentStatus', 'Full-time');
        safeSetValue('employer', 'Tech Solutions Inc');
        safeSetValue('jobTitle', 'Project Manager');
        safeSetValue('employmentDuration', '2 years');
        safeSetValue('supervisorName', 'Michael Chen');
        safeSetValue('supervisorPhone', '(555) 456-7890');
        safeSetValue('monthlyIncome', '5500');
        safeSetValue('otherIncome', '500');
        
        // Step 4
        safeSetValue('ref1Name', 'Robert Miller');
        safeSetValue('ref1Phone', '(555) 222-3333');
        safeSetValue('ref2Name', 'Lisa Thompson');
        safeSetValue('ref2Phone', '(555) 444-5555');
        safeSetValue('emergencyName', 'Jane Testerson');
        safeSetValue('emergencyPhone', '(555) 666-7777');
        safeSetValue('emergencyRelationship', 'Spouse');
        
        document.getElementById('evictedNo')?.click();
        document.getElementById('smokeNo')?.click();
        
        // Step 5 — payment icon grid (click Venmo as primary, PayPal as backup)
        const venmoCard  = document.querySelector('.payment-icon-card[data-method="Venmo"]');
        const paypalCard = document.querySelector('.payment-icon-card[data-method="PayPal"]');
        if (venmoCard)  venmoCard.click();
        if (paypalCard) paypalCard.click();
        
        // Step 6
        safeSetCheckbox('fcraConsent', true);
        safeSetCheckbox('certifyCorrect', true);
        safeSetCheckbox('authorizeVerify', true);
        safeSetCheckbox('termsAgree', true);
        
        if (window.app && typeof window.app.saveProgress === 'function') {
            window.app.saveProgress();
        }
        
        showTestFillNotification();
        
        if (window.app && typeof window.app.showSection === 'function') {
            window.app.showSection(1);
            window.app.updateProgressBar();
        }
    }
    
    function safeSetValue(id, value) {
        const el = document.getElementById(id);
        if (el) {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
        }
    }
    
    function safeSetSelect(id, value) {
        const el = document.getElementById(id);
        if (el) {
            el.value = value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    
    function safeSetCheckbox(id, checked) {
        const el = document.getElementById(id);
        if (el) {
            el.checked = checked;
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
    
    function showTestFillNotification() {
        const existing = document.getElementById('testFillNotification');
        if (existing) existing.remove();
        
        const notification = document.createElement('div');
        notification.id = 'testFillNotification';
        notification.innerHTML = `
            <i class="fas fa-check-circle"></i>
            <span>Test data filled! You can now edit any field.</span>
        `;
        notification.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            background: #10b981;
            color: white;
            padding: 16px 24px;
            border-radius: 60px;
            font-weight: 500;
            box-shadow: 0 10px 25px -5px rgba(16, 185, 129, 0.5);
            z-index: 100000;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideDown 0.3s ease;
            border: 2px solid white;
        `;
        
        if (!document.getElementById('testNotificationStyle')) {
            const style = document.createElement('style');
            style.id = 'testNotificationStyle';
            style.textContent = `
                @keyframes slideDown {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -20px);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, 0);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification) {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.3s';
                setTimeout(() => notification.remove(), 300);
            }
        }, 3000);
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTestButton);
    } else {
        initTestButton();
    }
})();

// ---------- Initialize app ----------
document.addEventListener('DOMContentLoaded', () => {
    window.app = new RentalApplication();
    const s1 = document.getElementById('section1');
    if (s1) s1.classList.add('active');
});