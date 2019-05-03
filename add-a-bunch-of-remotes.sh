for x in {1..10}
do
	git remote add "testing-with-alejandronanez-$x" https://github.com/alejandronanez/desktop
done

for x in {1..10}
do
	git remote add "testing-with-msztech-$x" https://github.com/msztech/desktop
done

for x in {1..10}
do
	git remote add "testing-with-otelom-$x" https://github.com/otelom/desktop
done

for x in {1..10}
do
	git remote add "testing-with-roottool-$x" https://github.com/roottool/desktop
done

for x in {1..10}
do
	git remote add "testing-with-Chris1904-$x" https://github.com/Chris1904/desktop
done

for x in {1..10}
do
	git remote add "testing-with-ahuth-$x" https://github.com/ahuth/desktop
done

git fetch --all
git for-each-ref refs/heads refs/remotes | wc -l
