/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.util.ArrayList;
import java.util.Random;

/**
 * @author jihad
 */
public class EnemyName {

    public String type, firstName, middleName, lastName, fullName;

    public EnemyName(String type) {
        this.type = type;
        fullName = setName();
    }

    public String setName() {
        String returnedName = "";

        // arrays will store names eg. "Feral Electrified Lizard"
        ArrayList<String> firstName = new ArrayList<String>();
        ArrayList<String> middleName = new ArrayList<String>();
        ArrayList<String> lastName = new ArrayList<String>();

        // stores the weights of each names, must be declared manually
        ArrayList<Integer> weightFirst = new ArrayList<Integer>();
        ArrayList<Integer> weightMiddle = new ArrayList<Integer>();
        ArrayList<Integer> weightLast = new ArrayList<Integer>();

        // each name will provide different bonuses and skills + the base stats and skills of the lastName
//<editor-fold defaultstate="collapsed" desc="Chapter 1 - Undercity">
        if (GameLogic.act == 1) { //UNDERCITY
//<editor-fold defaultstate="collapsed" desc="Beasts">
            if ("Beast".equals(type)) {
                // FIRST NAME - STATS mods
                firstName.add("Feral");// add STR DEX
                weightFirst.add(20);
                firstName.add("Aerobicized");// add CON
                weightFirst.add(20);
                firstName.add("Plated");// add AC
                weightFirst.add(20);

                firstName.add("Bestial"); // add STR DEX CON
                weightFirst.add(10);
                firstName.add("Unbreakable"); // add CON + AC
                weightFirst.add(10);
                firstName.add("Cunning"); // add AC + STR DEX
                weightFirst.add(10);

                firstName.add("Giant"); // add STR DEX CON + AC
                weightFirst.add(5);
                firstName.add("Monstrous"); // add STR DEX CON AC A LOT
                weightFirst.add(3);
                firstName.add("Mutated"); // add STR DEX CON AC A LOT + immunity to some elements, equivalent to UNDEAD
                weightFirst.add(2);

                // MIDDLE NAME - Elementals
                middleName.add("Cryo"); // Ice
                weightMiddle.add(20);
                middleName.add("Fiery"); // Fire
                weightMiddle.add(20);
                middleName.add("Electrified"); // Electro
                weightMiddle.add(20);
                middleName.add("Venomous"); // Poison
                weightMiddle.add(20);
                middleName.add("Psychogenic"); // Psychic
                weightMiddle.add(20);

                // LAST NAMES (Actual creature's name)
                lastName.add("Rat");
                weightLast.add(20);
                lastName.add("Snake");
                weightLast.add(20);
                lastName.add("Lizard");
                weightLast.add(20);
                lastName.add("Spider");
                weightLast.add(20);
                lastName.add("Raven");
                weightLast.add(20);

            } 
            //</editor-fold>
            //<editor-fold defaultstate="collapsed" desc="Humanoids">
            else if ("Humanoid".equals(type)) {
                //STATS mods
                //Tier 1
                firstName.add("Pumped");// add STR DEX
                weightFirst.add(20);
                firstName.add("Aerobicized");// add CON
                weightFirst.add(20);
                firstName.add("Armored");// add AC
                weightFirst.add(20);

                // Tier 2
                firstName.add("Intoxicated"); // add random 2 stats -- maybe this enemy after some rounds becomes abstinent
                weightFirst.add(10);
                firstName.add("Abstinent"); // remove random 2 stats
                weightFirst.add(10);

                firstName.add("Augmented"); // add STR DEX CON (Cyborg-like)
                weightFirst.add(10);

                // Tier 3 -- will modify the whole design of the humanoid (post-release)
                firstName.add("Raging"); // add STR DEX CON + AC
                weightFirst.add(5);
                firstName.add("Berserk"); // add STR DEX CON AC A LOT
                weightFirst.add(3);
                firstName.add("Mutated"); // add STR DEX CON AC A LOT + immunity to some elements, equivalent to UNDEAD
                weightFirst.add(2);

                // MIDDLE NAMES
                middleName.add(""); // None, humans won't have elemental names
                weightMiddle.add(1);

                // LAST NAMES (Actual creature's name)
                lastName.add("Thug");
                weightLast.add(20);
                lastName.add("Psycho");
                weightLast.add(20);
                lastName.add("Punk");
                weightLast.add(20);
                lastName.add("Stalker"); //STALKER
                weightLast.add(20);
                lastName.add("Conjurer");
                weightLast.add(20);
            }
        } //</editor-fold>
        //<editor-fold defaultstate="collapsed" desc="Chapter 2 - Upside Down">
        else if (GameLogic.act == 2) { //UPSIDE DOWN
            //<editor-fold defaultstate="collapsed" desc="Beasts">
            if ("Beast".equals(type)) {
                //STATS mods

                firstName.add("Mirrored");// Same Stats as player, also hp and AC
                weightFirst.add(30);
                firstName.add("Warped");// Same Stats as player, but randomized, same hp and AC
                weightFirst.add(30);

                firstName.add("Two-headed");// Extra STR and DEX
                weightFirst.add(15);
                firstName.add("Ruined");// Less all stats
                weightFirst.add(15);

                firstName.add("Giant"); // add STR DEX CON + AC
                weightFirst.add(5);
                firstName.add("Monstrous"); // add STR DEX CON AC A LOT
                weightFirst.add(3);
                firstName.add("Mutated"); // add STR DEX CON AC A LOT + immunity to some elements, equivalent to UNDEAD
                weightFirst.add(2);

                // Elementals
                middleName.add("Cryo"); // Ice
                weightMiddle.add(20);
                middleName.add("Fiery"); // Fire
                weightMiddle.add(20);
                middleName.add("Electrified"); // Electro
                weightMiddle.add(20);
                middleName.add("Venomous"); // Poison
                weightMiddle.add(20);
                middleName.add("Psychogenic"); // Psychic
                weightMiddle.add(20);

                // LAST NAMES (Actual creature's name)
                lastName.add("Rat");
                weightLast.add(20);
                lastName.add("Snake");
                weightLast.add(20);
                lastName.add("Lizard");
                weightLast.add(20);
                lastName.add("Spider");
                weightLast.add(20);
                lastName.add("Raven");
                weightLast.add(20);

            } else if ("Humanoid".equals(type)) {
                //STATS mods
                //Tier 1
                firstName.add("Mirrored");// Same Stats as player, also hp and AC
                weightFirst.add(30);
                firstName.add("Warped");// Same Stats as player, but randomized, same hp and AC
                weightFirst.add(30);

                // Tier 2
                firstName.add("Raving");// Extra STR and DEX
                weightFirst.add(15);
                firstName.add("Ruined");// Less all stats
                weightFirst.add(15);

                // Tier 3
                firstName.add("Frenzied"); // add STR DEX CON + AC
                weightFirst.add(5);
                firstName.add("Maddened"); // add STR DEX CON AC A LOT
                weightFirst.add(3);
                firstName.add("Demented"); // add STR DEX CON AC A LOT + immunity to some elements
                weightFirst.add(2);

                // MIDDLE NAMES
                middleName.add(""); // None, humans won't have elemental names
                weightMiddle.add(1);

                // LAST NAMES (Actual creature's name)
                lastName.add("Thug");
                weightLast.add(20);
                lastName.add("Psycho");
                weightLast.add(20);
                lastName.add("Punk");
                weightLast.add(20);
                lastName.add("Stalker"); //STALKER
                weightLast.add(20);
                lastName.add("Conjurer");
                weightLast.add(20);
            }

        } //</editor-fold>
        //<editor-fold defaultstate="collapsed" desc="Chapter 3 - Ashen Eternal City">
        else if (GameLogic.act == 3) { //White City - Here we will have only 'nightmares' https://www.artstation.com/midnight-98
            if ("Beast".equals(type)) {

            }
        } //</editor-fold>
        //<editor-fold defaultstate="collapsed" desc="Chapter 4 - The Inner World">
        else if (GameLogic.act == 4) { //The Inner World
            if ("Beast".equals(type)) {
                //STATS mods
                firstName.add("Furious");// add STR DEX
                weightFirst.add(20);
                firstName.add("Vigorous");// add CON
                weightFirst.add(20);
                firstName.add("Gilded");// add AC
                weightFirst.add(20);

                firstName.add("Bestial"); // add STR DEX CON
                weightFirst.add(10);
                firstName.add("Unbreakable"); // add CON + AC
                weightFirst.add(10);
                firstName.add("Fiendish"); // add AC + STR DEX
                weightFirst.add(10);

                firstName.add("Giant"); // add STR DEX CON + AC
                weightFirst.add(5);
                firstName.add("Monstrous"); // add STR DEX CON AC A LOT
                weightFirst.add(3);
                firstName.add("Gargantuan"); // add STR DEX CON AC A LOT + immunity to some elements, this b* huge, really. huge.
                weightFirst.add(2);

                // Elementals
                middleName.add(""); // None, these creatures are custom
                weightMiddle.add(1);

                // LAST NAMES (Actual creature's name)
                lastName.add("Hippalectryon"); //its like a horse with chicken features, but it flies
                weightLast.add(20);
                lastName.add("Hydra"); // lizard
                weightLast.add(20);
                lastName.add("Griffon");  //lion+bird
                weightLast.add(20);
                lastName.add("Camahueto"); // Bull + 1 horn middle of head
                weightLast.add(20);
                lastName.add("Chimaera"); //Goat+Snake+Lion+Lizard
                weightLast.add(20);
            }

        }
        //</editor-fold>

        // this function will set each names of the monsters in order (if they should (based on chance))
        String firstString = selectName(firstName, weightFirst, false);
        returnedName += firstString;
        String secondString = selectName(middleName, weightMiddle, false);
        returnedName += secondString;
        String thirdString = selectName(lastName, weightLast, true);
        returnedName += thirdString;

        return returnedName;
    }

    public boolean isName(int chance) {
        int randomNumber = (int) (Math.random() * (101 - 1)) + 1;
        return randomNumber < chance;
    }

    public String selectName(ArrayList names, ArrayList weight, boolean isLastName) { //firstName firstWeight

        //locally setting the arraylists
        ArrayList<String> namesLocal = names;
        ArrayList<Integer> weightLocal = weight;

        //this list will be filled with n weight amounts of each name in names
        ArrayList<String> fullList = new ArrayList<String>();

        Random rand = new Random();

        // 
        for (int i = 0; i < names.size(); i++) {

            boolean isName; //will be used as a percentage that must be achieved to generate the name
            // this checks each act and sets the chance of first and middle name occuring (one for each act)
            if (GameLogic.act != 0) { //here will be == 1, for example
                isName = isName(95); //50% chance
                if (isLastName) {
                    isName = true;
                }
                if (isName) {
                    for (int j = 0; j < weightLocal.get(i); j++) {
                        fullList.add(namesLocal.get(i));
                    }
                } else {
                    return "";
                }

            }
        }

        int randomArraySelector = rand.nextInt(fullList.size()); //will genearate a number equal to ArrayList size

        String returnString;

        if (isLastName) {
            returnString = fullList.get(randomArraySelector);
        } else {
            returnString = fullList.get(randomArraySelector) + " ";
        }

        return returnString;
    }

}
