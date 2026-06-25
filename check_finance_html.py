    with open('views/finance.html', 'r', encoding='utf-8') as f:
    content = f.read()

print("=== Search for tabs in views/finance.html ===")
for tab_id in ['journal', 'trial_balance', 'pl', 'ledger']:
    exists = f"financeTab-{tab_id}" in content
    print(f"Tab 'financeTab-{tab_id}': {exists}")

# Let's write the whole file to finance_html.txt so we can view it
with open('finance_html.txt', 'w', encoding='utf-8') as f:
    f.write(content)
print("views/finance.html written to finance_html.txt")
