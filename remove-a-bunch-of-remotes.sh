REMOTES=$(git remote)
IFS=$'\n' read -rd '' -a y <<<"$REMOTEs"

for remote in $REMOTES
do
  if [[ $remote == github-desktop-* ]];
	then
	  git remote rm $remote
	fi

	if [[ $remote == testing-with-* ]];
	then
	  git remote rm $remote
	fi
done
