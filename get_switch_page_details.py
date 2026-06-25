import re

with open('app.js', 'r', encoding='utf-8') as f:
    app_content = f.read()

sp_match = re.search(r"function\s+switchPage\s*\(", app_content)
if sp_match:
    start_pos = sp_match.start()
    # Let's count braces to find the end of switchPage function
    brace_count = 0
    end_pos = start_pos
    for i in range(start_pos, len(app_content)):
        if app_content[i] == '{':
            brace_count += 1
        elif app_content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                end_pos = i + 1
                break
    with open('switch_page_function.txt', 'w', encoding='utf-8') as out:
        out.write(app_content[start_pos:end_pos])
    print("switchPage written to switch_page_function.txt")
else:
    print("switchPage function not found!")
