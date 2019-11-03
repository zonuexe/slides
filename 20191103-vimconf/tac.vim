let i = 1
let lines = line('$')
while i < lines
    :$
    normal! dd
    execute ':' . i
    normal! P
    let i = i + 1
endwhile

update
qall!
